import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEARCH_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-search-pending-sources';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

describe('search pending replay sources', () => {
  it('pins the search_products_v2 compatibility repair to its checked-in bytes', async () => {
    const [sha256, filename, ...extra] =
      SEARCH_PENDING_REPLAY_SOURCE_ROWS.split(' ');
    expect(extra).toEqual([]);
    expect(filename).toBe(
      '20260827100000_fix_search_products_not_archived_nulls.sql'
    );

    const migration = await readFile(
      path.join(REPOSITORY_ROOT, 'supabase/migrations', filename)
    );
    expect(createHash('sha256').update(migration).digest('hex')).toBe(sha256);
  });
});
