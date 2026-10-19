import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  invalidateMounts,
  publishMounts,
} from './merchant-image-pilot-preflight-mounts-publish.mjs';

describe('merchant-image-pilot-preflight-mounts-publish', () => {
  it('returns null when writeMounts is omitted', async () => {
    expect(await invalidateMounts(undefined, 'offline failed')).toBeNull();
    expect(await publishMounts(undefined, [])).toBeNull();
  });

  it('publishes accepted mounts and invalidates prior artifacts on failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-mounts-publish-'));
    const target = join(dir, 'mounts.json');
    const sample = [{ assetId: 'logo-a', slotId: 'header-logo' }];

    expect(await publishMounts(target, sample)).toBeNull();
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual(sample);

    const note = await invalidateMounts(target, 'served check failed');
    expect(note).toBe('mounts not written: served check failed');
    await expect(stat(target)).rejects.toThrow();
  });

  it('reports write failure when target path is a directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-mounts-bad-'));
    const note = await publishMounts(dir, []);
    expect(note).toMatch(/^mounts not written:/);
  });
});
