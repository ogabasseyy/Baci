import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STOREFRONT_ORDER_TAIL_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-storefront-order-tail-pending-sources';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

describe('storefront order tail pending replay sources', () => {
  it('pins all pending order tail migrations to their checked-in bytes', async () => {
    const rows = STOREFRONT_ORDER_TAIL_PENDING_REPLAY_SOURCE_ROWS.split('\n');
    expect(rows.map((row) => row.split(' ')[1])).toEqual([
      '20261016100000_storefront_order_replay_key_floor.sql',
      '20261016110000_storefront_order_item_offer_id_snapshot.sql',
      '20261016115000_storefront_order_item_offer_identity_hardening.sql',
      '20261016125000_storefront_order_replay_economics_offer_snapshot.sql',
      '20261016140000_storefront_order_item_offer_identity_freeze.sql',
      '20261016150000_storefront_order_idempotency_key_entropy.sql',
      '20261016160000_storefront_order_item_offer_tenant_bind.sql',
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
