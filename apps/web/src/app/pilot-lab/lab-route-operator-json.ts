import { open } from 'node:fs/promises';
import { basename } from 'node:path';

// Frozen operator JSON is small (KBs for a pilot inventory); cap the
// request-path read so a malformed/huge file fails with an
// input-validation error instead of an OOM-prone read. Bounded before
// allocating: read at most budget+1 bytes through an open handle, so a
// multi-GB file is rejected without ever buffering or decoding it. (A
// stat-size pre-check alone has a grow-between-stat-and-read TOCTOU.)
export const MAX_OPERATOR_JSON_BYTES = 8 * 1024 * 1024;

export async function readBoundedOperatorJson(path: string): Promise<string> {
  const handle = await open(path, 'r');
  try {
    // Chunked loop instead of one budget-sized alloc: frozen operator
    // JSON is KBs, so every read pays for what it consumes (plus one
    // 64 KiB scratch chunk) rather than 8 MiB upfront — while a huge
    // file still rejects once reads cross budget+1.
    const chunks: Buffer[] = [];
    let total = 0;
    const scratch = Buffer.alloc(64 * 1024);
    for (;;) {
      const { bytesRead } = await handle.read(
        scratch,
        0,
        scratch.length,
        total
      );
      if (bytesRead === 0) {
        break;
      }
      total += bytesRead;
      if (total > MAX_OPERATOR_JSON_BYTES) {
        throw new Error(
          `merchant image pilot: ${basename(path)} exceeds the ${MAX_OPERATOR_JSON_BYTES}-byte operator JSON budget`
        );
      }
      chunks.push(Buffer.from(scratch.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await handle.close();
  }
}
