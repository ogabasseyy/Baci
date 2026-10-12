import 'server-only';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import type { PilotInventoryBinding } from '@/schemas/merchant-image-variant-pilot';
import { readUpToBytes } from './lab-config-stage-io-read';

export { readUpToBytes };

// Mirror of MAX_INPUT_BYTES in
// infra/cdn-transformer/pilot/constants.mjs: the staged snapshot read
// below must bound the same cap the generator enforces. Pinned by
// lab-config-stage-io.test.mjs against the original; web runtime code
// must not import infra directly.
const MAX_STAGED_SNAPSHOT_BYTES = 10 * 1024 * 1024;

// Exclusive-create flags for staged writes: 'wx' plus O_NOFOLLOW so a
// symlink swapped in after the destination lstat refuses at open time
// instead of diverting the create outside the stage root. Pinned by
// the flags test: O_NOFOLLOW is a zero bit where the platform lacks
// it, so the open degrades to plain 'wx' there.
export const STAGED_CREATE_FLAGS =
  fsConstants.O_WRONLY |
  fsConstants.O_CREAT |
  fsConstants.O_EXCL |
  fsConstants.O_NOFOLLOW;

// Staged-original suffixes must describe the bytes: Next serves public/
// files with a suffix-derived MIME type, and the served gate pins the
// response type to that same suffix. The inventory filename is
// operator-controlled and may lie, so the suffix comes from the
// decode-verified manifest format. Formats outside the served gate's
// known image set fail closed: there is no correct suffix for them.
const STAGED_ORIGINAL_EXTENSION_FOR_FORMAT: Record<string, string> = {
  avif: '.avif',
  gif: '.gif',
  jpeg: '.jpg',
  jpg: '.jpg',
  png: '.png',
  svg: '.svg',
  webp: '.webp',
};

export function originalFileName(
  binding: PilotInventoryBinding,
  sourceFormat: string
): string {
  const extension =
    STAGED_ORIGINAL_EXTENSION_FOR_FORMAT[sourceFormat.toLowerCase()];
  if (!extension) {
    throw new Error(
      `merchant image pilot: cannot stage an original with format "${sourceFormat}" (no servable suffix)`
    );
  }
  return `${binding.merchantId}-${binding.assetId}${extension}`;
}

// Creates a staging directory confined under the public dir, lstat-validating
// each level (never following links) so a planted symlink rejects with no
// out-of-tree changes. Returns the canonical dir for per-file confinement.
export async function ensureStageDir(
  publicDir: string,
  ...segments: string[]
): Promise<string> {
  const escapes = () =>
    new Error('merchant image pilot: staging directory escapes the public dir');
  const inaccessible = () =>
    new Error('merchant image pilot: staged public dir is not accessible');
  for (const segment of segments) {
    if (
      segment === '' ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes(sep)
    ) {
      throw escapes();
    }
  }
  // Anchor first: traverses only at-or-above the public dir.
  await mkdir(publicDir, { recursive: true }).catch(() => {
    throw inaccessible();
  });
  const levels = [publicDir];
  for (const segment of segments) {
    levels.push(join(levels[levels.length - 1] as string, segment));
  }
  for (const level of levels) {
    const existing = await lstat(level).catch(() => null);
    if (!existing) {
      await mkdir(level).catch(() => {
        throw inaccessible();
      });
    }
    const stat = existing ?? (await lstat(level).catch(() => null));
    if (!stat || stat.isSymbolicLink()) {
      throw escapes();
    }
    if (!stat.isDirectory()) {
      throw inaccessible();
    }
  }
  const realPublic = await realpath(publicDir);
  const real = await realpath(join(publicDir, ...segments));
  if (real !== realPublic && !real.startsWith(realPublic + sep)) {
    throw escapes();
  }
  return real;
}

export async function readVerifiedSnapshot(
  inputRoot: string,
  sourcePath: string,
  expectedSha256: string
): Promise<Buffer> {
  // Basename-free error like the snapshot catch below: the raw ENOENT
  // carries the absolute operator path, and loader errors can surface in
  // route error output on a shared host with the lab flag on.
  const realRoot = await realpath(inputRoot).catch(() => {
    throw new Error(
      'merchant image pilot: snapshot input root is not accessible'
    );
  });
  const joined = join(realRoot, sourcePath);
  if (joined !== realRoot && !joined.startsWith(realRoot + sep)) {
    throw new Error(
      'merchant image pilot: snapshot path escapes the input root'
    );
  }
  const real = await realpath(joined).catch(() => {
    throw new Error('merchant image pilot: snapshot is not accessible');
  });
  if (real !== realRoot && !real.startsWith(realRoot + sep)) {
    throw new Error(
      'merchant image pilot: snapshot path escapes the input root'
    );
  }
  // Bounded read: never allocate an unbounded file into memory.
  // Past-cap inputs are rejected instead of hashing a truncation.
  const { bytes, truncated } = await readUpToBytes(
    real,
    MAX_STAGED_SNAPSHOT_BYTES
  );
  if (truncated) {
    throw new Error(
      `merchant image pilot: snapshot exceeds the ${MAX_STAGED_SNAPSHOT_BYTES}-byte input limit`
    );
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expectedSha256) {
    throw new Error(
      'merchant image pilot: snapshot bytes differ from the frozen hash'
    );
  }
  return bytes;
}

async function assertParentConfined(
  stageRoot: string,
  destPath: string
): Promise<void> {
  const realParent = await realpath(dirname(destPath)).catch(() => {
    throw new Error(
      'merchant image pilot: staging destination is not accessible'
    );
  });
  if (realParent !== stageRoot && !realParent.startsWith(stageRoot + sep)) {
    throw new Error(
      'merchant image pilot: staging destination escapes the stage root'
    );
  }
}

// Writes staged bytes so a planted symlink can neither divert them nor
// survive as the served file: the parent must confine under the stage
// root, a symlink at the destination is refused (even when its target
// coincidentally holds identical bytes), and the file is created
// exclusively so a contender racing the write fails instead of
// redirecting the bytes outside the lab tree. 'wx' alone is not enough
// for the final component: it follows a symlink swapped in after the
// lstat and creates the link's target. O_NOFOLLOW binds the final
// component at open time (ELOOP on a link), the parent re-binds
// immediately before the open, and the written file re-binds after the
// close (handle identity vs path identity): a parent swapped for a link
// mid-stage refuses loudly instead of publishing verified bytes outside
// the stage root. The optional beforeOpen seam plants that mid-write
// swap deterministically in tests; production passes no hooks.
export async function writeStagedFile(
  stageRoot: string,
  destPath: string,
  bytes: Buffer,
  hooks?: { beforeOpen?: () => Promise<void> }
): Promise<void> {
  await assertParentConfined(stageRoot, destPath);
  const existing = await lstat(destPath).catch(() => null);
  if (existing?.isSymbolicLink()) {
    throw new Error(
      'merchant image pilot: staging destination is a symlink; refusing to write through it'
    );
  }
  if (existing) {
    await unlink(destPath);
  }
  await assertParentConfined(stageRoot, destPath);
  await hooks?.beforeOpen?.();
  const handle = await open(destPath, STAGED_CREATE_FLAGS).catch((error) => {
    throw new Error(
      'merchant image pilot: staging destination is a symlink or appeared mid-write; refusing to write',
      { cause: error }
    );
  });
  let identity: { dev: number; ino: number } | undefined;
  try {
    await handle.writeFile(bytes);
    identity = await handle.stat();
  } finally {
    await handle.close();
  }
  try {
    await assertParentConfined(stageRoot, destPath);
    const written = await lstat(destPath).catch(() => null);
    if (
      !written ||
      written.isSymbolicLink() ||
      !written.isFile() ||
      identity === undefined ||
      written.dev !== identity.dev ||
      written.ino !== identity.ino
    ) {
      throw new Error(
        'merchant image pilot: staged write no longer names the written file'
      );
    }
  } catch (error) {
    await unlink(destPath).catch(() => undefined);
    throw error;
  }
}

// Stages one approved tier by reading it once, validating the captured
// bytes against the verified size/hash, and writing that same buffer. A
// copy-after-verify would re-read the file and could stage swapped bytes.
// Destinations that already hold the verified bytes are left untouched, so
// the pre-start stage step is idempotent and request-time loads never churn
// post-start mtimes.
export async function stageVerifiedTier(input: {
  destPath: string;
  expectedBytes: number;
  expectedSha256: string;
  hooks?: { beforeOpen?: () => Promise<void> };
  sourcePath: string;
  stageRoot: string;
}): Promise<void> {
  // Bounded by the claimed size: a corrupted tier replaced with a
  // huge file rejects on size without allocating the whole file.
  const { bytes, truncated } = await readUpToBytes(
    input.sourcePath,
    input.expectedBytes
  );
  if (truncated || bytes.length !== input.expectedBytes) {
    throw new Error(
      'merchant image pilot: tier byte size changed before staging'
    );
  }
  if (
    createHash('sha256').update(bytes).digest('hex') !== input.expectedSha256
  ) {
    throw new Error('merchant image pilot: tier hash mismatch before staging');
  }
  if (await destMatches(input.destPath, bytes)) {
    return;
  }
  await writeStagedFile(input.stageRoot, input.destPath, bytes, input.hooks);
}

// Bytes-in-hand variant of the tier staging below: skips the write when
// the destination already holds the verified bytes in a single-linked
// file (idempotent stage, no post-start mtime churn), otherwise confines
// and writes as above. Hardlinked destinations always rewrite: the
// startup guard would refuse to boot them.
export async function writeStagedBytesIfChanged(
  stageRoot: string,
  destPath: string,
  bytes: Buffer,
  hooks?: { beforeOpen?: () => Promise<void> }
): Promise<void> {
  if (await destMatches(destPath, bytes)) {
    return;
  }
  await writeStagedFile(stageRoot, destPath, bytes, hooks);
}

async function destMatches(destPath: string, bytes: Buffer): Promise<boolean> {
  // A symlink never "matches": skipping the write would leave the link
  // in place and serve whatever it points at. A hardlink never matches
  // either — the startup guard rejects multi-linked descendants, so
  // skipping would stage ok:true for an unbootable lab. The write path
  // unlinks first, leaving a fresh single-linked inode.
  const info = await lstat(destPath).catch(() => null);
  if (!info || info.isSymbolicLink() || !info.isFile() || info.nlink > 1) {
    return false;
  }
  // Reject size mismatches on metadata first: a corrupted or swapped-in
  // giant destination must not load fully just to compare unequal.
  if (info.size !== bytes.length) {
    return false;
  }
  // Equal-sized files still read bounded: the destination can grow
  // between the stat and the read, and an unchecked readFile would
  // buffer the runaway bytes into the staging process.
  const existing = await readUpToBytes(destPath, bytes.length).catch(
    () => null
  );
  return (
    existing !== null &&
    !existing.truncated &&
    existing.bytes.length === bytes.length &&
    existing.bytes.equals(bytes)
  );
}
