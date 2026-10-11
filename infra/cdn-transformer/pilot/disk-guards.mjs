import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, realpath, rm, statfs } from 'node:fs/promises';
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

export async function readUpToBytes(path, maxBytes) {
  const handle = await open(path, 'r');
  try {
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
  const realTarget = await realpath(stagingDir).catch(() => {
    throw new PilotDiskError(`disk: staging directory is missing`);
  });
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
