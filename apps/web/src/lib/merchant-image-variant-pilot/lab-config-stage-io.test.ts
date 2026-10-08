import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureStageDir,
  readVerifiedSnapshot,
  stageVerifiedTier,
  writeStagedBytesIfChanged,
} from './lab-config-stage-io';

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
      stageRoot: await realpath(dir),
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
      stageRoot: await realpath(dir),
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
    const stageRoot = await realpath(dir);
    await expect(
      stageVerifiedTier({
        destPath: join(dir, 'bad-sha.avif'),
        expectedBytes: bytes.length,
        expectedSha256: '0'.repeat(64),
        sourcePath,
        stageRoot,
      })
    ).rejects.toThrow(/hash mismatch/);
    await expect(
      stageVerifiedTier({
        destPath: join(dir, 'bad-size.avif'),
        expectedBytes: bytes.length + 1,
        expectedSha256: sha,
        sourcePath,
        stageRoot,
      })
    ).rejects.toThrow(/byte size/);
    await expect(stat(join(dir, 'bad-sha.avif'))).rejects.toThrow();
    await expect(stat(join(dir, 'bad-size.avif'))).rejects.toThrow();
  });
});

describe('writeStagedBytesIfChanged', () => {
  it('refuses symlink destinations even when the target matches', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-link-'));
    const stageRoot = await ensureStageDir(dir, '__pilot');
    const bytes = Buffer.from('verified-tier-bytes');
    const outside = join(dir, 'outside.avif');
    await writeFile(outside, bytes);
    const link = join(stageRoot, 'staged.avif');
    await symlink(outside, link);
    // Identical target bytes must not skip the write: the link itself
    // would survive and serve outside bytes.
    await expect(
      writeStagedBytesIfChanged(stageRoot, link, bytes)
    ).rejects.toThrow(/symlink/);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(outside)).toEqual(bytes);
  });

  it('refuses stage directories that escape the public dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-escape-'));
    const elsewhere = await mkdtemp(join(tmpdir(), 'pilot-stage-req-'));
    await symlink(elsewhere, join(dir, '__pilot'));
    await expect(ensureStageDir(dir, '__pilot')).rejects.toThrow(/escapes/);
  });

  it('refuses destinations outside the stage root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-out-'));
    const stageRoot = await ensureStageDir(dir, '__pilot');
    await mkdir(join(dir, 'sibling'), { recursive: true });
    await expect(
      writeStagedBytesIfChanged(
        stageRoot,
        join(dir, 'sibling', 'x.avif'),
        Buffer.from('x')
      )
    ).rejects.toThrow(/escapes the stage root/);
  });
});

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
