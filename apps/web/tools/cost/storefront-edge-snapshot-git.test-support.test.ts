import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { snapshotGit } from './storefront-edge-snapshot-git.test-support';

it('disables automatic Git maintenance even when fixture configuration enables it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'snapshot-git-policy-'));
  try {
    await snapshotGit(root, 'init', '--quiet');
    await snapshotGit(root, 'config', '--local', 'gc.auto', '1');
    await snapshotGit(root, 'config', '--local', 'maintenance.auto', 'true');
    expect(await snapshotGit(root, 'config', '--get', 'gc.auto')).toBe('0');
    expect(await snapshotGit(root, 'config', '--get', 'maintenance.auto')).toBe(
      '0'
    );
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
});
