import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEED_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-feed-pending-sources';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

describe('feed pending replay sources', () => {
  it.each([
    [
      '06b8543596df16e6fa5fb5d24c6c2ef7418d34845c9189853a3187f34883b7a2',
      '20260918000000_public_active_product_offers.sql',
    ],
    [
      'a09484e4103859c8c9e2fe9da8b7023ba361bc64c2a6b65c73e72954da760acc',
      '20260920200000_stale_feed_manifest_on_offer_change.sql',
    ],
  ])('pins %s to its checked-in bytes', async (sha256, filename) => {
    const rows = FEED_PENDING_REPLAY_SOURCE_ROWS.trim().split('\n');
    expect(rows).toHaveLength(2);
    expect(rows).toContain(`${sha256} ${filename}`);

    const migration = await readFile(
      path.join(REPOSITORY_ROOT, 'supabase/migrations', filename)
    );
    expect(createHash('sha256').update(migration).digest('hex')).toBe(sha256);
  });
});
