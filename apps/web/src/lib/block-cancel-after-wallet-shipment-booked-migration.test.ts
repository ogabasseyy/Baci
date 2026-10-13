import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260904082100_block_cancel_after_wallet_shipment_booked.sql'
  ),
  'utf8'
);

describe('block cancel after wallet shipment booked migration', () => {
  it('blocks booked charges before the shipment_id null refund branch', () => {
    const bookedGuard = sql.indexOf(
      "charge.status IN ('booked', 'needs_reconciliation')"
    );
    const shipmentNullBranch = sql.indexOf('IF NEW.shipment_id IS NULL THEN');
    expect(bookedGuard).toBeGreaterThanOrEqual(0);
    expect(shipmentNullBranch).toBeGreaterThan(bookedGuard);
    expect(sql).toContain('ORDER_CANCELLED_BEFORE_SUBMISSION');
    expect(sql).toContain('active_merchant_shipping_charge');
  });
});
