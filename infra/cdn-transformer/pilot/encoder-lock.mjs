import { randomBytes } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { PilotGenerateError } from './generate-job.mjs';

// Output-root-wide encoder lock: the worker pool serializes encodes
// in-process, but two overlapping `generate.mjs` invocations on the same
// output root own independent queues and would encode concurrently,
// defeating the one-encoding-at-a-time resource bound and contaminating
// memory/capacity evidence. The generation run holds this lock for its
// whole duration; a contender on the same root fails fast instead of
// overlapping. Different output roots lock independently.
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
// claim.
// Steal safety: the dead claim is moved aside with an atomic rename
// and re-verified before replacement — a live claim that replaced it
// between the read and the rename is restored (when the path is still
// free) instead of silently deleted. Residual: a third linker inside
// the microsecond verify window keeps the path while the moved live
// claim is preserved as evidence; both live processes then hold until
// one releases. Closing that needs flock, which Node does not expose.
const LOCK_FILE = 'encoder.lock';
const ACQUIRE_ATTEMPTS = 3;
const CLAIM_TEMP_MAX_AGE_MS = 3_600_000;

function holderAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH: no such process (dead). Anything else (notably EPERM for
    // an unowned live pid) counts as alive — never steal on doubt.
    return error?.code !== 'ESRCH';
  }
}

async function confinedLocksDir(outputRoot) {
  const root = await realpath(outputRoot);
  const locksDir = join(root, 'locks');
  await mkdir(locksDir, { recursive: true });
  // A pre-existing symlink would sail through recursive mkdir and push
  // every lock op outside the output tree (same confinement as the
  // claims/generations/reports directories in generate.mjs).
  const info = await lstat(locksDir);
  if (
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    (await realpath(locksDir)) !== locksDir
  ) {
    throw new PilotGenerateError(
      'unsafe-output-directory',
      'locks must be a confined directory, not a symlink'
    );
  }
  return locksDir;
}

// Crash orphans from interrupted publications and steal recoveries:
// unique temp names, never the lock path. Swept best-effort past a
// generous age so the locks directory cannot grow without bound.
async function sweepStaleClaimTemps(locksDir) {
  const entries = await readdir(locksDir).catch(() => []);
  for (const entry of entries) {
    if (!/^(claim-\d+-[0-9a-f]+|recovering-.+)\.tmp$/.test(entry)) {
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
    `another pilot generation holds the encoder lock for ${outputRoot}; refusing to encode concurrently (crashed-run locks reclaim automatically once their pid exits — if no generation is running, verify with ps and remove ${path})`
  );
}

export async function acquireEncoderLock(outputRoot) {
  const locksDir = await confinedLocksDir(outputRoot);
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
      async release() {
        if (released) {
          return;
        }
        released = true;
        // Ownership-checked: unlink only our own claim. A successor's
        // claim (or an unreadable file) is left untouched.
        const text = await readFile(path, 'utf8').catch(() => null);
        if (text === null) {
          return;
        }
        let holder = null;
        try {
          holder = JSON.parse(text);
        } catch {
          return;
        }
        if (holder?.token !== token) {
          return;
        }
        await unlink(path).catch(() => undefined);
      },
    };
  }
  throw new PilotGenerateError(
    'encoder-lock-held',
    `could not acquire the encoder lock for ${outputRoot} after ${ACQUIRE_ATTEMPTS} attempts`
  );
}

// Returns true when the caller may retry publication, false when the
// lock is held, or 'corrupt' when the file is unparseable (atomic
// publication makes a mid-write corrupt read impossible).
async function stealWhenStale(path, locksDir) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    // Vanished between EEXIST and read: the holder released; retry.
    return true;
  }
  let holder = null;
  try {
    holder = JSON.parse(text);
  } catch {
    holder = null;
  }
  if (!holder || typeof holder !== 'object') {
    return 'corrupt';
  }
  if (holderAlive(holder.pid)) {
    // Live pid: held, at any age. Never evict on elapsed time.
    return false;
  }
  // Dead claim: move it aside atomically, then verify the moved file is
  // the claim just read. A plain unlink-then-create would silently
  // delete a live claim that replaced the dead one between the read
  // and the removal, leaving two live processes believing they hold
  // the lock.
  const recovery = join(
    locksDir,
    `recovering-${holder.token ?? 'untokened'}-${process.pid}-${randomBytes(8).toString('hex')}.tmp`
  );
  try {
    await rename(path, recovery);
  } catch (error) {
    // Already stolen or released between the read and the rename.
    if (error?.code === 'ENOENT') {
      return true;
    }
    throw error;
  }
  const moved = await readFile(recovery, 'utf8').catch(() => null);
  let movedHolder = null;
  try {
    movedHolder = moved ? JSON.parse(moved) : null;
  } catch {
    movedHolder = null;
  }
  if (movedHolder?.token !== holder.token || movedHolder?.pid !== holder.pid) {
    // A live claim replaced the dead one mid-steal: restore it when the
    // path is still free, then stand down. If a third linker already
    // claimed the path, the moved file stays as operator evidence.
    const restored = await link(recovery, path)
      .then(() => true)
      .catch(() => false);
    if (restored) {
      await unlink(recovery).catch(() => undefined);
    }
    return false;
  }
  await unlink(recovery).catch(() => undefined);
  return true;
}
