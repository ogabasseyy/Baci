import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readVerifiedSnapshot } from './lab-config-stage-read';

describe('readVerifiedSnapshot', () => {
  it('reads hash-verified snapshots and rejects over-cap inputs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-snap-'));
    const bytes = Buffer.from('snapshot-bytes');
    await writeFile(join(dir, 'a.png'), bytes);
    const sha = createHash('sha256').update(bytes).digest('hex');
    await expect(readVerifiedSnapshot(dir, 'a.png', sha)).resolves.toEqual(
      bytes
    );
    await expect(
      readVerifiedSnapshot(dir, 'a.png', '0'.repeat(64))
    ).rejects.toThrow(/differ from the frozen hash/);
    await expect(
      readVerifiedSnapshot(dir, '../escape.png', sha)
    ).rejects.toThrow(/escapes/);
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 7);
    await writeFile(join(dir, 'big.png'), big);
    await expect(
      readVerifiedSnapshot(
        dir,
        'big.png',
        createHash('sha256').update(big).digest('hex')
      )
    ).rejects.toThrow(/exceeds the .* input limit/);
  });
});
