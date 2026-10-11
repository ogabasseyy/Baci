// Exclusive encode-output lifecycle for the Sharp worker: claim, publish
// through the held descriptor, and post-write verification. Split from
// encode-worker.mjs under the repo line ceiling.
import { lstat, open, unlink } from 'node:fs/promises';

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
export async function claimEncodeOutput(output) {
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let handle;
    try {
      handle = await open(output, 'wx');
    } catch (error) {
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
    return { dev: identity.dev, handle, ino: identity.ino };
  }
  throw new WorkerInputError(
    'output-unsafe',
    'cannot claim an exclusive encode output'
  );
}

export async function verifyEncodeOutput(output, pinned) {
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
