// Exclusive encode-output lifecycle for the Sharp worker: claim, publish
// through the held descriptor, and post-write verification. Split from
// encode-worker.mjs under the repo line ceiling.
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import { dirname, sep } from 'node:path';

export class WorkerInputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'WorkerInputError';
  }
}

// Exclusive, confined output claim for encodes. The tier path is
// predictable (staging dir + stem/width/quality) and the run token is
// visible in the shared claims, so a quiescent symlink planted before
// the call would redirect the encoded bytes outside the staging tree
// while the stat/hash below follow it. 'wx' creation fails when ANY
// entry exists: links and non-regular entries refuse loudly, a stale
// regular file (partial from a previous attempt in this owned dir) is
// unlinked and retried boundedly. The claim returns the HELD handle —
// Sharp encodes to memory and the bytes publish through this descriptor,
// so no pathname reopen exists for a rename+symlink swap to exploit: an
// open descriptor cannot be redirected, and the post-write identity
// check below refuses to certify when the path no longer names it.
async function assertParentConfined(stagingRoot, output) {
  // The staging dir itself is the confinement root: a contender that
  // renames it away and plants a link (the run token is predictable
  // from the shared claim) would otherwise have 'wx' create the
  // encoded file outside the tree, and the dev/ino check below would
  // follow the same substituted parent and see the same inode. Both
  // sides canonicalize, so a symlinked staging root still matches.
  const realRoot = await realpath(stagingRoot).catch(() => {
    throw new WorkerInputError(
      'output-unsafe',
      'encode staging root is not accessible'
    );
  });
  const realParent = await realpath(dirname(output)).catch(() => {
    throw new WorkerInputError(
      'output-unsafe',
      'encode output parent is not accessible'
    );
  });
  if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
    throw new WorkerInputError(
      'output-unsafe',
      'encode output escapes the staging root'
    );
  }
  return realParent;
}

export async function claimEncodeOutput(output, stagingRoot) {
  const realParent = stagingRoot
    ? await assertParentConfined(stagingRoot, output)
    : null;
  // Quiescent plant first: 'wx' follows a dangling symlink and would
  // create its outside target, so links and non-regular entries refuse
  // before any open — not just on the EEXIST path below.
  const squat = await lstat(output).catch(() => null);
  if (squat && (squat.isSymbolicLink() || !squat.isFile())) {
    throw new WorkerInputError(
      'output-unsafe',
      'encode output path is not a regular file'
    );
  }
  const createFlags =
    fsConstants.O_WRONLY |
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    fsConstants.O_NOFOLLOW;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let handle;
    try {
      handle = await open(output, createFlags);
    } catch (error) {
      // O_NOFOLLOW binds the final component at open time: a link
      // swapped in after the lstat refuses instead of diverting the
      // create through it.
      if (error?.code === 'ELOOP') {
        throw new WorkerInputError(
          'output-unsafe',
          'encode output is a symlink; refusing to write through it'
        );
      }
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      const existing = await lstat(output).catch(() => null);
      if (!existing) {
        continue;
      }
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new WorkerInputError(
          'output-unsafe',
          'encode output path is not a regular file'
        );
      }
      await unlink(output);
      continue;
    }
    const identity = await handle.stat();
    return { dev: identity.dev, handle, ino: identity.ino, realParent };
  }
  throw new WorkerInputError(
    'output-unsafe',
    'cannot claim an exclusive encode output'
  );
}

export async function verifyEncodeOutput(output, pinned) {
  // The pinned parent re-binds: a staging dir swapped for a link after
  // the claim would otherwise pass the dev/ino check below, which
  // traverses the same substituted parent and sees the same inode.
  if (pinned?.realParent) {
    const realParent = await realpath(dirname(output)).catch(() => null);
    if (realParent !== pinned.realParent) {
      throw new WorkerInputError(
        'output-unsafe',
        'encode output parent changed during the write'
      );
    }
  }
  const info = await lstat(output).catch(() => null);
  if (
    !info ||
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.dev !== pinned.dev ||
    info.ino !== pinned.ino
  ) {
    throw new WorkerInputError(
      'output-unsafe',
      'encode output changed during the write'
    );
  }
}
