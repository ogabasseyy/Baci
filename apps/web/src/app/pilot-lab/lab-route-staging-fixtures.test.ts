import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ROUTE_MERCHANT,
  setupRouteFiles,
  stageRouteFiles,
} from './lab-route-staging-fixtures';

describe('lab-route-staging-fixtures', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sets up and stages route fixture files into the target public directory', async () => {
    expect(ROUTE_MERCHANT).toBe('6b5cb8a4-5575-456c-b936-8cdfae30db74');

    const roots = await setupRouteFiles();
    try {
      await expect(
        access(join(roots.inputRoot, 'inventory.json'))
      ).resolves.toBeUndefined();
      await expect(
        access(join(roots.outputRoot, 'acceptances.json'))
      ).resolves.toBeUndefined();

      vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
      await stageRouteFiles(roots);
      await expect(
        access(join(roots.publicDir, '__pilot'))
      ).resolves.toBeUndefined();
    } finally {
      await rm(join(roots.inputRoot, '..'), { force: true, recursive: true });
    }
  });
});
