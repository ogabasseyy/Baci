import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEED_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-feed-pending-sources';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

describe('feed pending replay sources', () => {
  it('pins the public active product offers policy to its checked-in bytes', async () => {
    const [sha256, filename, ...extra] =
      FEED_PENDING_REPLAY_SOURCE_ROWS.split(' ');
    expect(extra).toEqual([]);
    expect(filename).toBe('20260918000000_public_active_product_offers.sql');

    const migration = await readFile(
      path.join(REPOSITORY_ROOT, 'supabase/migrations', filename)
    );
    expect(createHash('sha256').update(migration).digest('hex')).toBe(sha256);
  });
});
