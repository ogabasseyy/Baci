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
// missing-input error). Mirrored by readUpToBytes in web
// lab-config-stage-io.ts (TS cannot import infra) and re-exported for
// the preflight stages.
export async function readUpToBytes(path, maxBytes) {
  const handle = await open(path, 'r');
  try {
    const probe = Buffer.alloc(maxBytes + 1);
    let bytesRead = 0;
    let short = false;
    while (bytesRead < probe.length && !short) {
      const chunk = await handle.read(
        probe,
        bytesRead,
        probe.length - bytesRead,
        bytesRead
      );
      bytesRead += chunk.bytesRead;
      short = chunk.bytesRead === 0;
    }
    return {
      bytes: Buffer.from(probe.subarray(0, Math.min(bytesRead, maxBytes))),
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
