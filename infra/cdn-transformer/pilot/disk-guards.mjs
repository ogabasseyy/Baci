import { realpath, rm, statfs } from 'node:fs/promises';
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
