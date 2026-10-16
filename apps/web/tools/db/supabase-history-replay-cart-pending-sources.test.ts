import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { EXPECTED_CART_PENDING_SOURCES } from './expected-cart-pending-sources.test-support';
import { supabaseHistoryReplayManifest as manifest } from './supabase-history-replay-manifest';

it('pins every cart addition as pending, never as deployed replay evidence', async () => {
  expect(EXPECTED_CART_PENDING_SOURCES).toHaveLength(46);
  for (const source of EXPECTED_CART_PENDING_SOURCES) {
    expect(
      manifest.pendingSources.filter(
        (x) => x.repositoryPath === source.repositoryPath
      )
    ).toEqual([source]);
    expect(
      manifest.postReplaySources.some(
        (x) => x.repositoryPath === source.repositoryPath
      )
    ).toBe(false);
    expect(
      manifest.productionMappings.some(
        (x) => x.repositoryPath === source.repositoryPath
      )
    ).toBe(false);
    expect(
      createHash('sha256')
        .update(await readFile(resolve('../..', source.repositoryPath)))
        .digest('hex')
    ).toBe(source.sha256);
  }
});
