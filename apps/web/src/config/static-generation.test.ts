import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATIC_GENERATION_LIMITS } from './static-generation';

const STOREFRONT_BUILD_WORKER_CAP = 1;

describe('STATIC_GENERATION_LIMITS', () => {
  it('activates the shared public-read gate only for production builds', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')
    ) as { scripts?: { build?: string; 'build:ci'?: string } };

    expect(packageJson.scripts?.build).toBe(
      'BACI_STOREFRONT_BUILD_READS=bounded NODE_ENV=production next build'
    );
    expect(packageJson.scripts?.['build:ci']).toBe(
      'BACI_STOREFRONT_BUILD_READS=offline NODE_ENV=production next build --experimental-build-mode=compile'
    );
  });

  it('serializes static workers while public clients share the read envelope', () => {
    expect(STATIC_GENERATION_LIMITS).toEqual({
      cpus: STOREFRONT_BUILD_WORKER_CAP,
      staticGenerationMaxConcurrency: 1,
      staticGenerationMinPagesPerWorker: 1_600,
      staticGenerationRetryCount: 3,
    });
  });
});
