import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reconcileStagedTree } from './lab-config-stage-reconcile';

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

  it('keeps current files and unknown top-level entries', async () => {
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
