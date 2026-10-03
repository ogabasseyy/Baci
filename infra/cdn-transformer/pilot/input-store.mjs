import { createHash, timingSafeEqual } from 'node:crypto';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { MAX_INPUT_BYTES } from './constants.mjs';

export const ASSET_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const SNAPSHOT_EXTENSION_PATTERN = /^(png|jpg|jpeg|webp|avif)$/;

export class PilotInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PilotInputError';
  }
}

function insideRoot(realRoot, candidate) {
  return candidate === realRoot || candidate.startsWith(realRoot + sep);
}

async function realInputRoot(inputRoot) {
  const real = await realpath(inputRoot).catch(() => {
    throw new PilotInputError(`input root is not accessible: ${inputRoot}`);
  });
  const info = await stat(real).catch(() => {
    throw new PilotInputError(`input root is not accessible: ${inputRoot}`);
  });
  if (!info.isDirectory()) {
    throw new PilotInputError(`input root is not a directory: ${inputRoot}`);
  }
  return real;
}

export async function resolveExistingInputPath(inputRoot, sourcePath) {
  const realRoot = await realInputRoot(inputRoot);
  const joined = join(realRoot, sourcePath);
  if (!insideRoot(realRoot, joined)) {
    throw new PilotInputError(`source path escapes the input root`);
  }
  const real = await realpath(joined).catch(() => {
    throw new PilotInputError(`source file is not accessible: ${sourcePath}`);
  });
  if (!insideRoot(realRoot, real)) {
    throw new PilotInputError(`source path escapes the input root`);
  }
  const info = await stat(real);
  if (!info.isFile()) {
    throw new PilotInputError(`source path is not a file: ${sourcePath}`);
  }
  return real;
}

export async function readInputSnapshot(inputRoot, sourcePath) {
  const resolvedPath = await resolveExistingInputPath(inputRoot, sourcePath);
  // Bound the read BEFORE allocating: a stat-then-read races a concurrent
  // replacement, so read at most MAX+1 bytes through an open handle. A file
  // that exceeds the cap — or grows past it mid-read — is rejected instead
  // of exhausting the generator process.
  const handle = await open(resolvedPath, 'r');
  try {
    const probe = Buffer.alloc(MAX_INPUT_BYTES + 1);
    const { bytesRead } = await handle.read(probe, 0, probe.length, 0);
    if (bytesRead > MAX_INPUT_BYTES) {
      throw new PilotInputError(
        `source file is too large: exceeds ${MAX_INPUT_BYTES} bytes`
      );
    }
    // Copy out so small snapshots don't pin the 10 MiB probe buffer.
    const bytes = Buffer.from(probe.subarray(0, bytesRead));
    return {
      bytes,
      resolvedPath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
    };
  } finally {
    await handle.close();
  }
}

export function verifySnapshotHash(snapshot, expectedSha256) {
  const actual =
    snapshot.sha256 ??
    createHash('sha256').update(snapshot.bytes).digest('hex');
  const left = Buffer.from(actual, 'utf8');
  const right = Buffer.from(expectedSha256, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

const MERCHANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function snapshotNameForAsset(merchantId, assetId, extension) {
  if (!MERCHANT_ID_PATTERN.test(merchantId ?? '')) {
    throw new PilotInputError(`unsafe merchant id for snapshot name`);
  }
  if (!ASSET_ID_PATTERN.test(assetId)) {
    throw new PilotInputError(`unsafe asset id for snapshot name`);
  }
  if (!SNAPSHOT_EXTENSION_PATTERN.test(extension)) {
    throw new PilotInputError(`unsupported snapshot extension: ${extension}`);
  }
  // Merchant-scoped stem so identical asset ids from different tenants can
  // never share (or falsely accuse) one snapshot file. The stem keeps the
  // 128-char flat-name budget; over-long asset ids are rejected, not cut.
  const stem = `${merchantId}-${assetId}`;
  if (stem.length > 128) {
    throw new PilotInputError(
      `snapshot stem exceeds the 128-character limit (${stem.length})`
    );
  }
  return `${stem}.${extension === 'jpeg' ? 'jpg' : extension}`;
}

export async function resolveNewSnapshotPath(inputRoot, fileName) {
  const realRoot = await realInputRoot(inputRoot);
  if (
    typeof fileName !== 'string' ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    fileName === '.' ||
    fileName === '..'
  ) {
    throw new PilotInputError(`unsafe snapshot file name`);
  }
  const target = join(realRoot, fileName);
  if (!insideRoot(realRoot, target)) {
    throw new PilotInputError(`snapshot path escapes the input root`);
  }
  const existing = await lstat(target).catch((error) => {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (existing?.isSymbolicLink()) {
    throw new PilotInputError(`snapshot path is a symlink: ${fileName}`);
  }
  return target;
}
