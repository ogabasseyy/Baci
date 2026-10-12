import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readUpToBytes, STAGED_READ_FLAGS } from './lab-config-stage-io-read';

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

  it('pins O_NOFOLLOW in the staged-read flags', async () => {
    // A revert to plain 'r' would still pass every bytes test while
    // reopening the read-through-link hole, so the flag bits are
    // pinned directly. O_NOFOLLOW degrades to plain 'r' on Windows.
    const { constants } = await import('node:fs');
    if (process.platform !== 'win32') {
      expect(STAGED_READ_FLAGS & constants.O_NOFOLLOW).toBe(
        constants.O_NOFOLLOW
      );
    }
  });

  it('refuses a symlink swapped in for staged bytes', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), 'pilot-read-link-'));
    const target = join(dir, 'target.bin');
    await writeFile(target, Buffer.from('elsewhere'));
    const link = join(dir, 'staged.bin');
    await symlink(target, link);
    await expect(readUpToBytes(link, 1024)).rejects.toThrow(/ELOOP/);
  });
});
