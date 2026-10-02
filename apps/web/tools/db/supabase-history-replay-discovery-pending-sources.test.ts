import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_DISCOVERY_PENDING_SOURCES } from './expected-discovery-pending-sources.test-support';
import { DISCOVERY_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-discovery-pending-sources';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const DISCOVERY_MIGRATIONS = [
  '20261002090720_public_variant_option_projection.sql',
  '20261002090721_fact_option_projection.sql',
  '20261002090722_browse_public_option_projection.sql',
  '20261002090723_variant_recall_public_option_projection.sql',
  '20261002090724_bounded_search_option_projection.sql',
  '20261002090725_discovery_base_option_and_finite_recall_bounds.sql',
  '20261002090726_variant_recall_base_condition.sql',
  '20261002090727_browse_base_condition_purchasability.sql',
  '20261002090728_fact_base_condition_purchasability.sql',
  '20261002090729_harden_public_condition_offer_matching.sql',
  '20261002090730_ascii_discovery_attribute_digest.sql',
  '20261002090731_managed_nullable_base_stock.sql',
] as const;

describe('discovery pending replay sources', () => {
  it('pins every discovery source to its current bytes and includes projection migrations', async () => {
    const replayRows = DISCOVERY_PENDING_REPLAY_SOURCE_ROWS.split('\n').map(
      (row) => {
        const [sha256, filename, ...extra] = row.trim().split(' ');
        expect(extra).toEqual([]);
        return { sha256, filename };
      }
    );
    const replayByFilename = new Map(
      replayRows.map(({ filename, sha256 }) => [filename, sha256])
    );
    const expectedByFilename = new Map(
      EXPECTED_DISCOVERY_PENDING_SOURCES.map(({ repositoryPath, sha256 }) => [
        path.posix.basename(repositoryPath),
        sha256,
      ])
    );

    for (const { sha256, filename } of replayRows) {
      expect(filename).toBeTruthy();
      const migration = await readFile(
        path.join(REPOSITORY_ROOT, 'supabase/migrations', filename)
      );
      expect(createHash('sha256').update(migration).digest('hex')).toBe(sha256);
    }

    for (const [filename, sha256] of expectedByFilename) {
      expect(replayByFilename.get(filename)).toBe(sha256);
    }
    expect(
      DISCOVERY_MIGRATIONS.every((filename) => expectedByFilename.has(filename))
    ).toBe(true);
  });
});
