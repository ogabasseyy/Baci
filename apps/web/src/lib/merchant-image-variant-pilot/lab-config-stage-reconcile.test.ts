import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertNoUnexpectedStagedFiles,
  reconcileStagedTree,
} from './lab-config-stage-reconcile';

const GEN = 'a'.repeat(64);

async function stageTree() {
  const pilotStage = await mkdtemp(join(tmpdir(), 'pilot-reconcile-'));
  await mkdir(join(pilotStage, GEN), { recursive: true });
  await mkdir(join(pilotStage, 'originals'), { recursive: true });
  await mkdir(join(pilotStage, 'fillers'), { recursive: true });
  return pilotStage;
}

describe('reconcileStagedTree', () => {
  it('removes stale nested directories with their served descendants', async () => {
    const pilotStage = await stageTree();
    const nested = join(pilotStage, GEN, 'stale-nested');
    await mkdir(join(nested, 'deep'), { recursive: true });
    await writeFile(join(nested, 'deep', 'old.avif'), 'stale');
    const nestedOriginal = join(pilotStage, 'originals', 'stale-nested');
    await mkdir(nestedOriginal, { recursive: true });
    await writeFile(join(nestedOriginal, 'old.png'), 'stale');
    const removed = await reconcileStagedTree({
      generationIds: [GEN],
      pilotStage,
      stagedFiles: [],
    });
    expect([...removed].sort()).toEqual([
      `${GEN}/stale-nested`,
      'originals/stale-nested',
    ]);
    await expect(lstat(nested)).rejects.toThrow(/ENOENT/);
    await expect(lstat(nestedOriginal)).rejects.toThrow(/ENOENT/);
  });

  it('removes a directory squatting a currently staged file path', async () => {
    const pilotStage = await stageTree();
    const tierPath = join(pilotStage, GEN, 'tier.avif');
    await mkdir(tierPath, { recursive: true });
    await writeFile(join(tierPath, 'planted.avif'), 'stale');
    // The path is current (a file was staged here), but staging writes
    // files only: a directory at the path squats it and must not survive.
    const removed = await reconcileStagedTree({
      generationIds: [GEN],
      pilotStage,
      stagedFiles: [tierPath],
    });
    expect(removed).toEqual([`${GEN}/tier.avif`]);
    await expect(lstat(tierPath)).rejects.toThrow(/ENOENT/);
  });

  it('keeps current files and the fillers directory', async () => {
    const pilotStage = await stageTree();
    const tierPath = join(pilotStage, GEN, 'tier.avif');
    await writeFile(tierPath, 'current');
    const fillerPath = join(pilotStage, 'fillers', 'grid-filler-600x400-a.png');
    await writeFile(fillerPath, 'filler');
    const removed = await reconcileStagedTree({
      generationIds: [GEN],
      pilotStage,
      stagedFiles: [tierPath],
    });
    expect(removed).toEqual([]);
    await expect(lstat(tierPath)).resolves.toBeDefined();
    await expect(lstat(fillerPath)).resolves.toBeDefined();
  });

  it('unlinks planted symlinks without following them', async () => {
    const pilotStage = await stageTree();
    const outside = await mkdtemp(join(tmpdir(), 'pilot-reconcile-out-'));
    const target = join(outside, 'precious.txt');
    await writeFile(target, 'precious');
    const link = join(pilotStage, GEN, 'evil.avif');
    await symlink(target, link);
    const removed = await reconcileStagedTree({
      generationIds: [GEN],
      pilotStage,
      stagedFiles: [],
    });
    expect(removed).toEqual([`${GEN}/evil.avif`]);
    await expect(lstat(link)).rejects.toThrow(/ENOENT/);
    await expect(lstat(target)).resolves.toBeDefined();
  });

  it('removes files and symlinks squatting managed names', async () => {
    const pilotStage = await stageTree();
    const squatter = join(pilotStage, 'b'.repeat(64));
    await writeFile(squatter, 'junk');
    const outside = join(await mkdtemp(join(tmpdir(), 'lab-keep-')), 'keep');
    await writeFile(outside, 'precious');
    const linkSquatter = join(pilotStage, 'c'.repeat(64));
    await symlink(outside, linkSquatter);
    const originalsFile = join(pilotStage, 'originals');
    await rm(originalsFile, { force: true, recursive: true });
    await writeFile(originalsFile, 'junk');
    const removed = await reconcileStagedTree({
      generationIds: [GEN],
      pilotStage,
      stagedFiles: [],
    });
    // Managed names are always directories: the squatters unlink (the
    // link itself, never its target) instead of silently surviving a
    // stage the startup guard would then refuse to start.
    expect(removed).toContain('b'.repeat(64));
    expect(removed).toContain('c'.repeat(64));
    expect(removed).toContain('originals');
    await expect(lstat(squatter)).rejects.toThrow(/ENOENT/);
    await expect(lstat(linkSquatter)).rejects.toThrow(/ENOENT/);
    await expect(lstat(originalsFile)).rejects.toThrow(/ENOENT/);
    await expect(lstat(outside)).resolves.toBeDefined();
  });

  it('fails staging on unknown top-level entries', async () => {
    const pilotStage = await stageTree();
    await mkdir(join(pilotStage, 'old-assets'), { recursive: true });
    await writeFile(join(pilotStage, 'old-assets', 'stale.png'), 'stale');
    // The startup guard refuses every entry outside fillers, originals,
    // and generation ids: staging must fail here, not report ok for a
    // tree that cannot boot. The unknown entry is left for the operator.
    await expect(
      reconcileStagedTree({
        generationIds: [GEN],
        pilotStage,
        stagedFiles: [],
      })
    ).rejects.toThrow(/unknown staged entry "old-assets"/);
    await expect(
      lstat(join(pilotStage, 'old-assets', 'stale.png'))
    ).resolves.toBeDefined();
  });

  it('fails staging when fillers is not a directory', async () => {
    const pilotStage = await stageTree();
    await rm(join(pilotStage, 'fillers'), { force: true, recursive: true });
    await writeFile(join(pilotStage, 'fillers'), 'junk');
    await expect(
      reconcileStagedTree({
        generationIds: [GEN],
        pilotStage,
        stagedFiles: [],
      })
    ).rejects.toThrow(/unknown staged entry "fillers"/);
  });

  // Root bypasses permission bits, so the unreadable-directory case is
  // untestable there; every other runner exercises the real EACCES path.
  it.skipIf(typeof process.geteuid === 'function' && process.geteuid() === 0)(
    'fails closed when a managed directory cannot be listed',
    async () => {
      const pilotStage = await stageTree();
      const originals = join(pilotStage, 'originals');
      const stale = join(originals, 'stale.png');
      await writeFile(stale, 'stale');
      await chmod(originals, 0o000);
      try {
        // An unreadable originals dir aborts the stage: treating it as
        // empty would report completion while stale bytes stay reachable.
        await expect(
          reconcileStagedTree({
            generationIds: [GEN],
            pilotStage,
            stagedFiles: [],
          })
        ).rejects.toThrow(/EACCES/);
      } finally {
        await chmod(originals, 0o755);
      }
      await expect(lstat(stale)).resolves.toBeDefined();
    }
  );
});

describe('assertNoUnexpectedStagedFiles', () => {
  const staged = (pilotStage: string) => [
    { path: join(pilotStage, GEN, 'tier-w800.avif') },
    { path: join(pilotStage, 'originals', 'merchant.png') },
  ];

  async function seedExpected(pilotStage: string) {
    await writeFile(join(pilotStage, GEN, 'tier-w800.avif'), 'tier');
    await writeFile(join(pilotStage, 'originals', 'merchant.png'), 'orig');
  }

  it('accepts exactly the allowlisted staged files', async () => {
    const pilotStage = await stageTree();
    await seedExpected(pilotStage);
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).resolves.toBe(undefined);
  });

  it('rejects regular files planted after staging', async () => {
    const pilotStage = await stageTree();
    await seedExpected(pilotStage);
    await writeFile(join(pilotStage, 'originals', 'planted.png'), 'evil');
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).rejects.toThrow(/has no inventory binding/);
  });

  it('rejects plants inside current generations but not stale ones', async () => {
    const pilotStage = await stageTree();
    await seedExpected(pilotStage);
    await writeFile(join(pilotStage, GEN, 'planted.avif'), 'evil');
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).rejects.toThrow(/has no inventory binding/);
    // Stale generation dirs (previous runs) stay accepted by design.
    const stale = join(pilotStage, 'b'.repeat(64));
    await mkdir(stale, { recursive: true });
    await writeFile(join(stale, 'old.avif'), 'stale');
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).rejects.toThrow(/planted\.avif/);
  });

  it('rejects nested dirs, links, and special files', async () => {
    const pilotStage = await stageTree();
    await seedExpected(pilotStage);
    await mkdir(join(pilotStage, 'originals', 'nested'), { recursive: true });
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).rejects.toThrow(/unexpected staged directory/);
  });

  it('rejects a symlink planted in originals', async () => {
    const pilotStage = await stageTree();
    await seedExpected(pilotStage);
    await symlink(
      join(pilotStage, 'originals', 'merchant.png'),
      join(pilotStage, 'originals', 'link.png')
    );
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).rejects.toThrow(/not a regular file/);
  });
});
