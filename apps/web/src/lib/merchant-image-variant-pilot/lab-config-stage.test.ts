import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stageVerifiedTier } from './lab-config';

describe('stageVerifiedTier', () => {
  it('stages exactly the bytes it validated', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-'));
    const sourcePath = join(dir, 'tier.avif');
    const bytes = Buffer.from('verified-tier-bytes');
    await writeFile(sourcePath, bytes);
    const destPath = join(dir, 'staged.avif');
    await stageVerifiedTier({
      destPath,
      expectedBytes: bytes.length,
      expectedSha256: createHash('sha256').update(bytes).digest('hex'),
      sourcePath,
    });
    expect(await readFile(destPath)).toEqual(bytes);
  });

  it('leaves verified-identical destinations untouched, heals drifted ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-'));
    const sourcePath = join(dir, 'tier.avif');
    const bytes = Buffer.from('verified-tier-bytes');
    await writeFile(sourcePath, bytes);
    const input = {
      expectedBytes: bytes.length,
      expectedSha256: createHash('sha256').update(bytes).digest('hex'),
      sourcePath,
    };
    // Identical dest: backdate it, restage, mtime must not move.
    const identical = join(dir, 'identical.avif');
    await writeFile(identical, bytes);
    const old = new Date('2020-01-01T00:00:00.000Z');
    await utimes(identical, old, old);
    await stageVerifiedTier({ ...input, destPath: identical });
    expect((await stat(identical)).mtimeMs).toBe(old.getTime());
    // Drifted dest: same length, different bytes → overwritten with verified.
    const drifted = join(dir, 'drifted.avif');
    const wrong = Buffer.from('VERIFIED-TIER-BYTES');
    await writeFile(drifted, wrong);
    await stageVerifiedTier({ ...input, destPath: drifted });
    expect(await readFile(drifted)).toEqual(bytes);
  });

  it('refuses to stage bytes that fail validation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-'));
    const sourcePath = join(dir, 'tier.avif');
    const bytes = Buffer.from('unverified-tier-bytes');
    await writeFile(sourcePath, bytes);
    const sha = createHash('sha256').update(bytes).digest('hex');
    await expect(
      stageVerifiedTier({
        destPath: join(dir, 'bad-sha.avif'),
        expectedBytes: bytes.length,
        expectedSha256: '0'.repeat(64),
        sourcePath,
      })
    ).rejects.toThrow(/hash mismatch/);
    await expect(
      stageVerifiedTier({
        destPath: join(dir, 'bad-size.avif'),
        expectedBytes: bytes.length + 1,
        expectedSha256: sha,
        sourcePath,
      })
    ).rejects.toThrow(/byte size/);
    await expect(stat(join(dir, 'bad-sha.avif'))).rejects.toThrow();
    await expect(stat(join(dir, 'bad-size.avif'))).rejects.toThrow();
  });
});
