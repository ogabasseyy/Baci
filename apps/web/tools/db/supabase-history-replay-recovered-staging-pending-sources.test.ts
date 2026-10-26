import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_RECOVERED_STAGING_PENDING_SOURCES } from './expected-recovered-staging-pending-sources.test-fixture';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';
import { verifySupabaseHistoryReplayManifest } from './verify-supabase-history-replay-manifest';

const root = path.resolve(__dirname, '../../../..');

describe('recovered staging pending migrations', () => {
  it('registers the exact ordered sources, hashes, and no production mappings', async () => {
    const nonPendingPaths = new Set([
      supabaseHistoryReplayManifest.repair.path,
      ...supabaseHistoryReplayManifest.forwardRepairs.map(({ path }) => path),
      ...supabaseHistoryReplayManifest.postReplaySources.map(
        ({ repositoryPath }) => repositoryPath
      ),
      ...supabaseHistoryReplayManifest.productionMappings.map(
        ({ repositoryPath }) => repositoryPath
      ),
    ]);
    const registered = supabaseHistoryReplayManifest.pendingSources.filter(
      ({ repositoryPath }) =>
        EXPECTED_RECOVERED_STAGING_PENDING_SOURCES.some(
          (source) => source.repositoryPath === repositoryPath
        )
    );

    expect(registered).toEqual(EXPECTED_RECOVERED_STAGING_PENDING_SOURCES);
    expect(
      new Set(registered.map(({ repositoryPath }) => repositoryPath)).size
    ).toBe(EXPECTED_RECOVERED_STAGING_PENDING_SOURCES.length);
    expect(
      registered.some((source, index) => {
        const previous = registered[index - 1];
        return previous && previous.repositoryPath >= source.repositoryPath;
      })
    ).toBe(false);

    for (const source of EXPECTED_RECOVERED_STAGING_PENDING_SOURCES) {
      const body = await readFile(path.join(root, source.repositoryPath));
      expect(createHash('sha256').update(body).digest('hex')).toBe(
        source.sha256
      );
      expect(nonPendingPaths.has(source.repositoryPath)).toBe(false);
    }

    await expect(
      verifySupabaseHistoryReplayManifest(root, {
        pendingRepairState: 'materialized',
      })
    ).resolves.toMatchObject({ pendingRepairState: 'materialized' });
  }, 60_000);
});
