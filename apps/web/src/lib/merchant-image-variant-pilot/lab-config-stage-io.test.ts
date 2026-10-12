import { createHash } from 'node:crypto';
import {
  link,
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
  readUpToBytes,
  readVerifiedSnapshot,
  stageVerifiedTier,
  writeStagedBytesIfChanged,
} from './lab-config-stage-io';

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

  it('rejects an oversized source without allocating the whole file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-'));
    const sourcePath = join(dir, 'huge.avif');
    await writeFile(sourcePath, Buffer.alloc(2 * 1024 * 1024, 9));
    await expect(
      stageVerifiedTier({
        destPath: join(dir, 'huge-staged.avif'),
        expectedBytes: 10,
        expectedSha256: '0'.repeat(64),
        sourcePath,
        stageRoot: await realpath(dir),
      })
    ).rejects.toThrow(/byte size/);
    await expect(stat(join(dir, 'huge-staged.avif'))).rejects.toThrow();
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

  it('replaces a hardlinked destination even when the bytes match', async () => {
    // Matching bytes must not skip the write: the startup guard rejects
    // multi-linked descendants, so skipping would stage ok:true for a lab
    // that cannot boot. The rewrite unlinks first, leaving a fresh
    // single-linked inode; the outside link keeps the old bytes.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-hardlink-'));
    const stageRoot = await ensureStageDir(dir, '__pilot');
    const bytes = Buffer.from('verified-tier-bytes');
    const dest = join(stageRoot, 'staged.avif');
    await writeFile(dest, bytes);
    const outside = join(dir, 'outside.avif');
    await link(dest, outside);
    expect((await lstat(dest)).nlink).toBe(2);
    await writeStagedBytesIfChanged(stageRoot, dest, bytes);
    expect(await readFile(dest)).toEqual(bytes);
    expect((await lstat(dest)).nlink).toBe(1);
    expect(await readFile(outside)).toEqual(bytes);
  });

  it('replaces a giant destination without loading it fully', async () => {
    // A corrupted previously staged destination (huge regular file)
    // must reject on size metadata and be replaced — never buffered
    // whole into the staging process for comparison.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-giant-'));
    const stageRoot = await ensureStageDir(dir, '__pilot');
    const bytes = Buffer.from('verified-tier-bytes');
    const dest = join(stageRoot, 'staged.avif');
    await writeFile(dest, Buffer.alloc(32 * 1024 * 1024, 7));
    await writeStagedBytesIfChanged(stageRoot, dest, bytes);
    expect(await readFile(dest)).toEqual(bytes);
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

  it('refuses a staging parent swapped for a symlink mid-stage', async () => {
    // The parent verified confined at ensureStageDir time, then a
    // contender renamed it away and planted a link: 'wx' alone would
    // create through the link outside the stage root. The destination
    // routes through the planted name (not the stale canonical root)
    // so the write must re-bind the parent instead of failing on a
    // missing path.
    const { readdir, rename } = await import('node:fs/promises');
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-swap-'));
    const stageRoot = await ensureStageDir(dir, '__pilot');
    const outside = join(dir, 'outside');
    await mkdir(outside, { recursive: true });
    await rename(join(dir, '__pilot'), join(dir, '__pilot-moved'));
    await symlink(outside, join(dir, '__pilot'));
    await expect(
      writeStagedBytesIfChanged(
        stageRoot,
        join(dir, '__pilot', 'staged.avif'),
        Buffer.from('verified-tier-bytes')
      )
    ).rejects.toThrow(/escapes the stage root/);
    expect(await readdir(outside)).toEqual([]);
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
