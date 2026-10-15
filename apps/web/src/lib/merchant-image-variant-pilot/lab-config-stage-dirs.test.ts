import { mkdtemp, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureStageDir } from './lab-config-stage-dirs';

describe('ensureStageDir planted-symlink rejection', () => {
  it('rejects a pre-planted __pilot symlink with no out-of-tree changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-noside-'));
    const elsewhere = await mkdtemp(join(tmpdir(), 'pilot-stage-req-'));
    await writeFile(join(elsewhere, 'sentinel.txt'), 'untouched');
    await symlink(elsewhere, join(dir, '__pilot'));
    // Recursive mkdir would create through the link before the realpath
    // check throws; per-level lstat validation must reject first.
    await expect(ensureStageDir(dir, '__pilot')).rejects.toThrow(/escapes/);
    await expect(ensureStageDir(dir, '__pilot', 'originals')).rejects.toThrow(
      /escapes/
    );
    expect(await readdir(elsewhere)).toEqual(['sentinel.txt']);
  });

  it('still creates a fresh nested stage in-tree', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-fresh-'));
    const stage = await ensureStageDir(dir, '__pilot', 'originals');
    expect(await readdir(join(dir, '__pilot'))).toEqual(['originals']);
    expect(stage.endsWith(join('__pilot', 'originals'))).toBe(true);
  });

  it('rejects path-traversal segments without writing out-of-tree', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-traversal-'));
    await expect(ensureStageDir(dir, '..', 'evil')).rejects.toThrow(/escapes/);
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses stage directories that escape the public dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-escape-'));
    const elsewhere = await mkdtemp(join(tmpdir(), 'pilot-stage-req-'));
    await symlink(elsewhere, join(dir, '__pilot'));
    await expect(ensureStageDir(dir, '__pilot')).rejects.toThrow(/escapes/);
  });
});
