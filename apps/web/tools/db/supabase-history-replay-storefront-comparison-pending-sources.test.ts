import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STOREFRONT_COMPARISON_PENDING_REPLAY_SOURCE_ROW } from './supabase-history-replay-storefront-comparison-pending-sources';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

describe('storefront comparison pending replay source', () => {
  it('pins the append-only comparison-revision migration to its checked-in bytes', async () => {
    const [sha256, filename, ...extra] =
      STOREFRONT_COMPARISON_PENDING_REPLAY_SOURCE_ROW.split(' ');

    expect(extra).toEqual([]);
    expect(filename).toBe(
      '20260911100000_add_storefront_comparison_revisions.sql'
    );
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);

    const migration = await readFile(
      path.join(REPOSITORY_ROOT, 'supabase/migrations', filename)
    );
    expect(createHash('sha256').update(migration).digest('hex')).toBe(sha256);
  });
});
