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
import { ensureStageDir } from './lab-config-stage-dirs';
import {
  STAGED_CREATE_FLAGS,
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

  it('refuses a symlink swapped in after the destination check', async () => {
    // The destination is absent when lstat runs, then a contender
    // plants dest -> outside/target before the open: 'wx' alone would
    // follow the link and create the outside target. O_NOFOLLOW must
    // refuse at open time with nothing created through the link.
    const { readdir } = await import('node:fs/promises');
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-raced-link-'));
    const stageRoot = await ensureStageDir(dir, '__pilot');
    const outside = join(dir, 'outside');
    await mkdir(outside, { recursive: true });
    const dest = join(stageRoot, 'staged.avif');
    await expect(
      writeStagedBytesIfChanged(
        stageRoot,
        dest,
        Buffer.from('verified-tier-bytes'),
        {
          beforeOpen: async () => {
            await symlink(join(outside, 'target.avif'), dest);
          },
        }
      )
    ).rejects.toThrow(/symlink or appeared mid-write/);
    expect(await readdir(outside)).toEqual([]);
    expect((await lstat(dest)).isSymbolicLink()).toBe(true);
  });

  it('pins O_NOFOLLOW in the staged-create flags', async () => {
    // A revert to plain 'wx' would pass the race test on macOS (BSD
    // O_EXCL already refuses symlinks) while reopening the
    // create-through-link hole on Linux, so the flag bits are pinned
    // directly. O_NOFOLLOW degrades to plain 'wx' on Windows.
    const { constants } = await import('node:fs');
    expect(STAGED_CREATE_FLAGS & constants.O_EXCL).toBe(constants.O_EXCL);
    if (process.platform !== 'win32') {
      expect(STAGED_CREATE_FLAGS & constants.O_NOFOLLOW).toBe(
        constants.O_NOFOLLOW
      );
    }
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
