import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEARCH_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-search-pending-sources';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

describe('search pending replay sources', () => {
  it('pins both pending search migrations to their checked-in bytes', async () => {
    const rows = SEARCH_PENDING_REPLAY_SOURCE_ROWS.split('\n');
    expect(rows.map((row) => row.split(' ')[1])).toEqual([
      '20260827100000_fix_search_products_not_archived_nulls.sql',
      '20261002090046_storefront_search_refinements.sql',
    ]);
    for (const row of rows) {
      const [sha256, filename, ...extra] = row.split(' ');
      expect(extra).toEqual([]);
      const migration = await readFile(
        path.join(REPOSITORY_ROOT, 'supabase/migrations', filename)
      );
      expect(createHash('sha256').update(migration).digest('hex')).toBe(sha256);
    }
  });
});
