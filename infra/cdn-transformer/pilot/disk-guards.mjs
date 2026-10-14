import { createHash } from 'node:crypto';
import { constants as fsConstants, createReadStream } from 'node:fs';
import { lstat, open, realpath, rm, statfs, unlink } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { MAX_STAGING_BYTES, MIN_FREE_BYTES } from './constants.mjs';

export const STAGING_DIR_PREFIX = 'staging-';

export class PilotDiskError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PilotDiskError';
  }
}

export async function getAvailableBytes(path) {
  const info = await statfs(path).catch(() => {
    throw new PilotDiskError(`disk: path is not accessible: ${path}`);
  });
  return info.bavail * info.bsize;
}

export async function assertMinFreeBytes(path, minBytes = MIN_FREE_BYTES) {
  const available = await getAvailableBytes(path);
  if (available < minBytes) {
    throw new PilotDiskError(
      `disk: free space ${available} bytes is below the ${minBytes} byte floor`
    );
  }
  return available;
}

export function createStagingBudget(capBytes = MAX_STAGING_BYTES) {
  let used = 0;
  return {
    get cap() {
      return capBytes;
    },
    get used() {
      return used;
    },
    charge(bytes) {
      if (!Number.isInteger(bytes) || bytes < 0) {
        throw new PilotDiskError(`disk: cannot charge negative bytes`);
      }
      if (used + bytes > capBytes) {
        throw new PilotDiskError(
          `disk: staging cap ${capBytes} bytes exceeded (${used} + ${bytes})`
        );
      }
      used += bytes;
    },
  };
}

// Bounded read: at most maxBytes + 1, looping to EOF-or-cap (a single
// read may return short). Returns truncated: true when the file is
// longer, so callers reject the size mismatch without ever allocating
// the whole file. Throws when unreadable (callers map that to their
// missing-input error). Chunked: streams 64 KiB at a time instead of
// allocating maxBytes + 1 upfront, so a large ceiling never becomes a
// large allocation on its own. Mirrored by readUpToBytes in web
// lab-config-stage-io.ts (TS cannot import infra) and re-exported for
// the preflight stages.
const READ_CHUNK_BYTES = 64 * 1024;

// Constant-memory file hash: a replaced or grown file hashes without
// ever buffering it whole, so hash verification cannot OOM the reader
// no matter how large the file became. Read errors propagate raw, like
// readFile's — callers map them to their own error types.
export async function sha256File(path) {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

// Read flags for guarded bytes: O_RDONLY plus O_NOFOLLOW so a symlink
// swapped in after the caller's lstat refuses at open time (ELOOP)
// instead of serving the link target's bytes, plus O_NONBLOCK so a
// FIFO swapped into the same window cannot hang the open past every
// deadline before any enforcement starts. Pinned by the flags test;
// both are zero bits where the platform lacks them, so the open
// degrades to plain 'r' there.
export const GUARDED_READ_FLAGS =
  fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;

export async function readUpToBytes(path, maxBytes) {
  const handle = await open(path, GUARDED_READ_FLAGS);
  try {
    // fstat on the opened handle: the byte ceiling bounds reads, not
    // the open wait, so anything but a regular file refuses here
    // before the first read.
    const opened = await handle.stat();
    if (!opened.isFile()) {
      throw new PilotDiskError(`disk: refusing to read non-file: ${path}`);
    }
    const chunks = [];
    let bytesRead = 0;
    for (;;) {
      const want = Math.min(READ_CHUNK_BYTES, maxBytes + 1 - bytesRead);
      if (want <= 0) {
        break;
      }
      const probe = Buffer.alloc(want);
      const chunk = await handle.read(probe, 0, want, bytesRead);
      if (chunk.bytesRead === 0) {
        break;
      }
      chunks.push(probe.subarray(0, chunk.bytesRead));
      bytesRead += chunk.bytesRead;
    }
    const buffered = Buffer.concat(chunks);
    return {
      bytes: buffered.subarray(0, Math.min(bytesRead, maxBytes)),
      truncated: bytesRead > maxBytes,
    };
  } finally {
    await handle.close();
  }
}

export async function removeOwnedStaging(outputRoot, stagingDir) {
  const realRoot = await realpath(outputRoot).catch(() => {
    throw new PilotDiskError(`disk: output root is not accessible`);
  });
  // The pathname itself must be a real directory: realpath alone
  // resolves a planted symlink to a sibling staging-* directory, and
  // the parent/prefix checks below would then pass while rm deletes
  // the other run's tree instead of the caller's link.
  const owned = await lstat(stagingDir).catch(() => {
    throw new PilotDiskError(`disk: staging directory is missing`);
  });
  if (!owned.isDirectory()) {
    throw new PilotDiskError(`disk: staging path is not a directory`);
  }
  const realTarget = await realpath(stagingDir).catch(() => {
    throw new PilotDiskError(`disk: staging directory is missing`);
  });
  // Identity bind: the canonical target must still be the directory
  // lstat just accepted, or a swap between the two calls redirected
  // the removal. A swap after this bind but before rm is the residual
  // window, same as the verified generation loader accepts.
  const bound = await lstat(realTarget).catch(() => {
    throw new PilotDiskError(`disk: staging directory is missing`);
  });
  if (bound.dev !== owned.dev || bound.ino !== owned.ino) {
    throw new PilotDiskError(`disk: staging directory changed during cleanup`);
  }
  if (!realTarget.startsWith(realRoot + sep)) {
    throw new PilotDiskError(`disk: staging path escapes the output root`);
  }
  if (
    dirname(realTarget) !== realRoot ||
    !basename(realTarget).startsWith(STAGING_DIR_PREFIX)
  ) {
    throw new PilotDiskError(`disk: refusing to remove unowned path`);
  }
  await rm(realTarget, { force: true, recursive: true });
}

export function ownedStagingPath(outputRoot, runToken) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(runToken)) {
    throw new PilotDiskError(`disk: unsafe run token`);
  }
  return join(outputRoot, `${STAGING_DIR_PREFIX}${runToken}`);
}

// Confined exclusive file write: 'wx' guards only the FINAL path
// component, so a staging parent renamed away and replaced with a
// symlink after setup would redirect a plain writeFile outside the
// owned tree. Node has no openat, so the write binds to the checked
// parent three ways: the parent resolves to canonical immediately
// before the open (a day-long window becomes microseconds, and the
// open itself goes through the canonical path with no symlink
// components left to exploit), the bytes publish through the held
// descriptor, and after the close the parent name must still resolve
// to that same directory AND the pathname must still name the written
// file (handle identity vs path identity). Any mismatch unlinks the
// stray name best-effort and throws loudly. Residual: a swap won and
// reverted entirely between the checks can still land bytes outside —
// detection, not prevention, past the microsecond windows — so callers
// treat this as the freeze binding, not a whole-run guarantee.
async function canonicalConfinedDir(dir) {
  const info = await lstat(dir).catch(() => {
    throw new PilotDiskError(`disk: confined directory is not accessible`);
  });
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new PilotDiskError(`disk: confined path is not a directory`);
  }
  return realpath(dir);
}

export async function writeConfinedFile(dir, name, bytes, options = {}) {
  const { sync = true } = options;
  const expected = await canonicalConfinedDir(dir);
  const path = join(expected, name);
  const handle = await open(path, 'wx');
  let identity;
  try {
    await handle.writeFile(bytes);
    // sync:false skips only the fsync: confinement (exclusive create in
    // the canonical parent) and the post-close rebind below still hold.
    // Degraded-durability callers use this after classifying an
    // unsupported-sync failure, never preemptively.
    if (sync) {
      await handle.sync();
    }
    identity = await handle.stat();
  } finally {
    await handle.close();
  }
  try {
    if ((await canonicalConfinedDir(dir)) !== expected) {
      throw new PilotDiskError(
        `disk: confined directory changed during the write`
      );
    }
    const info = await lstat(path).catch(() => null);
    if (
      !info ||
      info.isSymbolicLink() ||
      !info.isFile() ||
      info.dev !== identity.dev ||
      info.ino !== identity.ino
    ) {
      throw new PilotDiskError(
        `disk: confined write no longer names the written file`
      );
    }
  } catch (error) {
    await unlink(path).catch(() => undefined);
    throw error;
  }
}

// Directory-entry durability for publish paths: a file fsync persists the
// bytes but not the directory entry that names them, so a temp+rename
// publish (or a direct create) must sync the parent directory after the
// entry lands — otherwise power loss can roll the publish back while the
// caller reported success. Throws the platform error; callers classify
// unsupported sync versus abort-worthy failures.
export async function fsyncDir(dir) {
  const handle = await open(dir, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// fsync failure classification: only "operation not supported" signals
// a platform that cannot sync. Anything else (ENOSPC, EIO, ...) means
// the bytes may never have reached stable storage and must abort rather
// than publish a potentially non-durable result.
export function isUnsupportedSyncError(error) {
  return error?.code === 'ENOSYS' || error?.code === 'EINVAL';
}
