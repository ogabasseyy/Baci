import 'server-only';
import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';

// Bounded read: at most maxBytes + 1, looping to EOF-or-cap (a single
// read may return short). Returns truncated: true when the file is
// longer, so callers reject the size mismatch without ever allocating
// the full file — a corrupted tier concatenated into a huge file must
// fail closed, not exhaust the server. Throws when unreadable (callers
// map that to their missing-input error). Split from
// lab-config-stage-io.ts under the repo line ceiling; mirrors
// readUpToBytes in infra/cdn-transformer/pilot/disk-guards.mjs (TS
// cannot import infra).
const READ_CHUNK_BYTES = 64 * 1024;

// Read flags for staged bytes: O_RDONLY plus O_NOFOLLOW so a symlink
// swapped in after the caller's lstat refuses at open time (ELOOP)
// instead of serving the link target's bytes. Pinned by the flags
// test; O_NOFOLLOW is a zero bit where the platform lacks it, so the
// open degrades to plain 'r' there.
export const STAGED_READ_FLAGS = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;

export async function readUpToBytes(
  path: string,
  maxBytes: number
): Promise<{ bytes: Buffer; truncated: boolean }> {
  const handle = await open(path, STAGED_READ_FLAGS);
  try {
    // Chunked probe: stream 64 KiB at a time instead of allocating
    // maxBytes + 1 upfront, so a large ceiling (per-entry staged sizes
    // up to the 256 MiB set budget) never becomes a large allocation
    // on its own — memory grows with actual file content, capped at
    // maxBytes + 1 total.
    const chunks: Buffer[] = [];
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
