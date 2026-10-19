import 'server-only';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import { dirname, sep } from 'node:path';
import { readUpToBytes } from './lab-config-stage-io-read';

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
// component at open time (ELOOP on a link). The parent is pinned by a
// held directory fd across the create: Node exposes no dirfd-relative
// open, so path validation and creation cannot be one atomic step —
// instead the confined parent's identity (dev+ino through the fd) is
// captured before the open and re-compared after the close. A parent
// swapped for an outside dir fails re-confinement; a parent swapped
// for another inside dir (which re-confinement passes) fails the
// identity check; a parent restored before the check fails the
// handle/path comparison. Every ordering fails loudly with nothing
// silently published outside the verified tree. The optional
// beforeOpen seam plants that mid-write swap deterministically in
// tests; production passes no hooks.
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
  // Pin AFTER the final pre-open check: the fd must name the same
  // directory object the confinement check just verified.
  const parentHandle = await open(dirname(destPath), 'r');
  try {
    const pinnedParent = await parentHandle.stat();
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
      // lstat, not stat: a symlink swapped in for the parent must
      // mismatch even when it points back inside the stage root.
      const currentParent = await lstat(dirname(destPath));
      if (
        currentParent.dev !== pinnedParent.dev ||
        currentParent.ino !== pinnedParent.ino
      ) {
        throw new Error(
          'merchant image pilot: staging parent changed during the write; refusing to publish'
        );
      }
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
  } finally {
    await parentHandle.close();
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
