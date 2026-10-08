import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { JOB_TIMEOUT_MS, MAX_JOBS } from './constants.mjs';
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
// steals it when the recorded pid is dead (kill(pid, 0) ESRCH — EPERM
// means alive-but-unowned). Age steals a live holder only past the
// provable run ceiling (PID reuse or a stuck runaway — never a
// legitimate run). Corrupt content steals only past a grace window, so
// a contender never unlinks a file its holder is still writing.
const LOCK_FILE = 'encoder.lock';
const ACQUIRE_ATTEMPTS = 3;
const CORRUPT_GRACE_MS = 30_000;
// Provable run ceiling: at most MAX_JOBS sequential jobs, each under the
// absolute job deadline, doubled for I/O slack. A holder older than this
// with a live pid is PID reuse after a crash (or a stuck runaway), never
// a legitimate run — safe to reclaim.
const MAX_RUN_MS = MAX_JOBS * JOB_TIMEOUT_MS * 2;

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

export async function acquireEncoderLock(outputRoot) {
  const locksDir = join(outputRoot, 'locks');
  await mkdir(locksDir, { recursive: true });
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
          `another pilot generation holds the encoder lock for ${outputRoot}; refusing to encode concurrently (stale locks from crashed runs are reclaimed automatically)`
        );
      }
      continue;
    }
    try {
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })
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
    const startedAt = Date.parse(holder.startedAt);
    if (!Number.isFinite(startedAt) || Date.now() - startedAt <= MAX_RUN_MS) {
      return false;
    }
    // Live pid past the provable run ceiling: PID reuse or a stuck
    // runaway. Reclaim.
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
