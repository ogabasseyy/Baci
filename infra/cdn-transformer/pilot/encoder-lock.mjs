import { randomBytes } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  stat,
  unlink,
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
// Staleness: a crashed holder leaves the file behind, so a contender
// steals it only when the recorded pid is dead (kill(pid, 0) ESRCH —
// EPERM means alive-but-unowned). A LIVE pid is ALWAYS held, however
// old the claim: elapsed time never proves ownership loss (a stalled
// syscall is not a dead process), so PID reuse after a crash needs
// explicit operator recovery, not automatic eviction. Corrupt content
// steals only past a grace window, so a contender never unlinks a file
// its holder is still writing. Release is ownership-checked: a resumed
// original never unlinks a successor's claim.
const LOCK_FILE = 'encoder.lock';
const ACQUIRE_ATTEMPTS = 3;
const CORRUPT_GRACE_MS = 30_000;

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

export async function acquireEncoderLock(outputRoot) {
  const locksDir = await confinedLocksDir(outputRoot);
  const path = join(locksDir, LOCK_FILE);
  for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt += 1) {
    let handle = null;
    try {
      handle = await open(path, 'wx');
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      if (!(await stealWhenStale(path))) {
        throw new PilotGenerateError(
          'encoder-lock-held',
          `another pilot generation holds the encoder lock for ${outputRoot}; refusing to encode concurrently (crashed-run locks reclaim automatically once their pid exits — if no generation is running, verify with ps and remove ${path})`
        );
      }
      continue;
    }
    const token = randomBytes(16).toString('hex');
    try {
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
          token,
        })
      );
    } finally {
      await handle.close();
    }
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

async function stealWhenStale(path) {
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
  if (holder && typeof holder === 'object' && holderAlive(holder.pid)) {
    // Live pid: held, at any age. Never evict on elapsed time.
    return false;
  }
  if (!holder || typeof holder !== 'object') {
    // Corrupt content: steal only past the grace window (a live
    // holder may still be writing its claim).
    const info = await stat(path).catch(() => null);
    if (!info || Date.now() - info.mtimeMs < CORRUPT_GRACE_MS) {
      return false;
    }
  }
  await unlink(path).catch(() => undefined);
  return true;
}
