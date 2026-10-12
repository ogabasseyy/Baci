import { randomBytes } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLockText, stealWhenStale } from './encoder-lock-steal.mjs';
import { PilotGenerateError } from './generate-job.mjs';

// Host-wide encoder lock: the worker pool serializes encodes
// in-process, but two overlapping `generate.mjs` invocations own
// independent queues and would encode concurrently — defeating the
// one-encoding-at-a-time resource bound and contaminating
// memory/capacity evidence — even on different output roots. The lock
// therefore lives at a shared host location, not beneath the
// caller-selected output root. The generation run holds it for its
// whole duration; a contender fails fast instead of overlapping.
//
// Atomic publication: the claim is written complete to a unique temp
// file, then hard-linked to the lock path — link() either publishes the
// whole claim or fails EEXIST, so the lock file is NEVER observed
// empty or partially written. A stalled creator therefore cannot be
// mistaken for an abandoned corrupt lock: there is no corrupt-grace
// steal, because age never proves abandonment.
// Staleness: a crashed holder leaves a complete claim behind, so a
// contender steals it only when the recorded pid is dead (kill(pid, 0)
// ESRCH — EPERM means alive-but-unowned). A LIVE pid is ALWAYS held,
// however old the claim, and corrupt content (external tampering only,
// since publication is atomic) fails closed for the operator. Release
// is ownership-checked: a resumed original never unlinks a successor's
// claim. Steal protocol lives in encoder-lock-steal.mjs.
const LOCK_FILE = 'encoder.lock';
const ACQUIRE_ATTEMPTS = 3;
const CLAIM_TEMP_MAX_AGE_MS = 3_600_000;

// A lock directory — host default or injected — must be a real
// directory owned by this user and unwritable by anyone else: a
// world-writable directory pre-created by another user would
// otherwise let them replace or forge encoder.lock and defeat
// serialization (or block generation outright). Type, owner, and
// mode are all verified; canonicalized before use (the tmpdir
// itself may resolve through a system link). POSIX-only: platforms
// without uid/mode semantics (Windows) rely on the per-user tmpdir
// ACLs instead.
async function assertConfinedLocksDir(dir) {
  const info = await lstat(dir).catch(() => null);
  const real = info ? await realpath(dir).catch(() => null) : null;
  if (!real || !info || info.isSymbolicLink() || !info.isDirectory()) {
    throw new PilotGenerateError(
      'unsafe-output-directory',
      'encoder locks must be a confined directory, not a symlink'
    );
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new PilotGenerateError(
      'unsafe-output-directory',
      'encoder locks directory is owned by another user'
    );
  }
  if (typeof process.getuid === 'function' && (info.mode & 0o022) !== 0) {
    throw new PilotGenerateError(
      'unsafe-output-directory',
      'encoder locks directory is writable by another user'
    );
  }
  return real;
}

// Shared host lock directory, scoped to the effective uid: another
// user's records would classify EPERM-held forever (a cross-user DoS)
// or invite cross-user steals, while same-user concurrent roots — the
// bound that matters — still serialize. Created owner-only so a
// pre-existing lax directory fails the mode check above instead of
// silently serving shared state.
async function hostEncoderLocksDir() {
  const euid =
    typeof process.geteuid === 'function' ? process.geteuid() : 'shared';
  const dir = join(tmpdir(), `pilot-encoder-locks-${euid}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return assertConfinedLocksDir(dir);
}

// Crash orphans from interrupted publications, steal recoveries, and
// releases: unique temp names, never the lock path. Swept best-effort
// past a generous age so the locks directory cannot grow without bound.
async function sweepStaleClaimTemps(locksDir) {
  const entries = await readdir(locksDir).catch(() => []);
  for (const entry of entries) {
    if (
      !/^(claim-\d+-[0-9a-f]+|recovering-.+|releasing-.+)\.tmp$/.test(entry)
    ) {
      continue;
    }
    const temp = join(locksDir, entry);
    const info = await stat(temp).catch(() => null);
    if (info && Date.now() - info.mtimeMs > CLAIM_TEMP_MAX_AGE_MS) {
      await unlink(temp).catch(() => undefined);
    }
  }
}

function lockHeldError(outputRoot, path) {
  return new PilotGenerateError(
    'encoder-lock-held',
    `another pilot generation (output root ${outputRoot}) holds the host encoder lock; refusing to encode concurrently (crashed-run locks reclaim automatically once their pid exits — if no generation is running, verify with ps and remove ${path})`
  );
}

export async function acquireEncoderLock(outputRoot, options = {}) {
  // Host-global by default (one encoding at a time per host, across all
  // output roots). options.locksDir isolates test acquisitions so
  // parallel suites never contend for the shared host lock; injected
  // dirs confine exactly like the default.
  const locksDir =
    options.locksDir === undefined
      ? await hostEncoderLocksDir()
      : await assertConfinedLocksDir(options.locksDir);
  const path = join(locksDir, LOCK_FILE);
  await sweepStaleClaimTemps(locksDir);
  for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt += 1) {
    const token = randomBytes(16).toString('hex');
    const temp = join(
      locksDir,
      `claim-${process.pid}-${randomBytes(8).toString('hex')}.tmp`
    );
    await writeFile(
      temp,
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        token,
      }),
      { flag: 'wx' }
    );
    try {
      await link(temp, path);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      const stolen = await stealWhenStale(path, locksDir);
      if (stolen === 'corrupt') {
        throw new PilotGenerateError(
          'encoder-lock-corrupt',
          `encoder lock file ${path} is corrupt (publication is atomic, so this means external tampering or disk fault); verify no generation is running and remove it`
        );
      }
      if (!stolen) {
        throw lockHeldError(outputRoot, path);
      }
      continue;
    }
    await unlink(temp).catch(() => undefined);
    let released = false;
    return {
      // Mid-run ownership check: a steal-race loser can rename this
      // run's live claim away and admit a second encoder on the host
      // (see encoder-lock-steal.mjs). The run calls this before encoding —
      // at job start and before every variant attempt — so a displaced
      // run aborts loudly within one encode instead of encoding
      // concurrently and contaminating the resource evidence. Residual:
      // the check-then-encode window itself is unchecked, bounding any
      // silent overlap to a single variant attempt.
      async assertHeld() {
        const text = await readLockText(path).catch(() => null);
        let holder = null;
        if (text !== null) {
          try {
            holder = JSON.parse(text);
          } catch {
            holder = null;
          }
        }
        if (holder?.token !== token) {
          throw new PilotGenerateError(
            'encoder-lock-evicted',
            `encoder lock ${path} changed owner mid-run; another encoder holds the host lock — aborting instead of encoding concurrently`
          );
        }
      },
      async release() {
        if (released) {
          return;
        }
        released = true;
        // Atomic release, mirroring the steal protocol: move the pathname
        // aside, then verify the MOVED file is our claim before deleting.
        // Read-then-unlink would delete a successor's claim published
        // between the read and the unlink. A foreign moved-aside claim is
        // restored (link fails closed when a successor already claimed
        // the path); same documented residual as the steal path.
        const releasing = join(
          locksDir,
          `releasing-${token}-${process.pid}.tmp`
        );
        try {
          await rename(path, releasing);
        } catch {
          // Already gone (stolen or released): nothing of ours to free.
          return;
        }
        const moved = await readLockText(releasing).catch(() => null);
        let movedHolder = null;
        try {
          movedHolder = moved ? JSON.parse(moved) : null;
        } catch {
          movedHolder = null;
        }
        if (movedHolder?.token !== token) {
          const restored = await link(releasing, path)
            .then(() => true)
            .catch(() => false);
          if (restored) {
            await unlink(releasing).catch(() => undefined);
          }
          return;
        }
        await unlink(releasing).catch(() => undefined);
      },
    };
  }
  throw new PilotGenerateError(
    'encoder-lock-held',
    `could not acquire the host encoder lock for ${outputRoot} after ${ACQUIRE_ATTEMPTS} attempts`
  );
}
