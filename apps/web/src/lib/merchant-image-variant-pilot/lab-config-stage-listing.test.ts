import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listStagedDir } from './lab-config-stage-listing';

describe('listStagedDir', () => {
  it('lists a readable directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-listing-'));
    await writeFile(join(dir, 'a.png'), 'x');
    const entries = await listStagedDir(dir, 'test', new Set());
    expect(entries?.map((entry) => entry.name)).toEqual(['a.png']);
  });

  it('skips a missing directory when nothing is expected under it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-listing-'));
    await expect(
      listStagedDir(join(dir, 'absent'), 'test', new Set())
    ).resolves.toBeNull();
  });

  it('refuses a missing directory with bound files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-listing-'));
    const missing = join(dir, 'absent');
    await expect(
      listStagedDir(missing, 'test', new Set([join(missing, 'tier-w800.avif')]))
    ).rejects.toThrow(/missing with bound files/);
  });

  it('aborts on an unreadable directory instead of accepting empty', async () => {
    // Searchable-but-unreadable (mode 0111) still serves known
    // pathnames: extras would go undiscovered, so the listing
    // failure aborts verification. POSIX-only (chmod-based).
    if (process.platform === 'win32') {
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), 'pilot-listing-'));
    const target = join(dir, 'originals');
    await mkdir(target);
    await writeFile(join(target, 'merchant.png'), 'orig');
    await chmod(target, 0o111);
    try {
      await expect(
        listStagedDir(target, 'originals', new Set())
      ).rejects.toThrow(/cannot list staged directory/);
    } finally {
      await chmod(target, 0o755);
    }
  });
});
