import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readUpToBytes } from './lab-config-stage-io-read';

describe('readUpToBytes', () => {
  it('streams multi-chunk files to the cap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-read-chunked-'));
    const file = join(dir, 'big.bin');
    const payload = Buffer.alloc(200 * 1024);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] = index % 251;
    }
    await writeFile(file, payload);
    await expect(readUpToBytes(file, 300 * 1024)).resolves.toEqual({
      bytes: payload,
      truncated: false,
    });
    const capped = await readUpToBytes(file, 100 * 1024);
    expect(capped.truncated).toBe(true);
    expect(capped.bytes).toEqual(payload.subarray(0, 100 * 1024));
  });
});
