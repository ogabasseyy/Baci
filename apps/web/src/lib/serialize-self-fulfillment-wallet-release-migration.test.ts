import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260904082400_serialize_self_fulfillment_wallet_release.sql'
  ),
  'utf8'
);

describe('serialize self fulfillment wallet release migration', () => {
  it('atomically releases reserved charges and marks self-fulfillment under order lock', () => {
    expect(sql).toContain('self_fulfill_order_with_wallet_release');
    expect(sql).toContain(
      "pg_catalog.hashtextextended('merchant-shipping-order:' || p_order_id::text, 0)"
    );
    expect(sql).toContain('SELF_FULFILL_BEFORE_SUBMISSION');
    expect(sql).toContain("shipping_status = 'shipped'");
    expect(sql).toContain('active_shipment_booking_lock');
  });
});
