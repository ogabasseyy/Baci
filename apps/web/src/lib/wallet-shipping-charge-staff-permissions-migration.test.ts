import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903133000_authorize_wallet_shipping_charge_staff.sql`,
  'utf8'
);

describe('wallet shipping charge staff authorization migration', () => {
  it('allows the same order permissions as the booking workflows', () => {
    expect(sql).toContain(
      'DROP POLICY IF EXISTS merchant_shipping_charges_owner_read'
    );
    expect(sql).toContain("'orders', 'fulfill'");
    expect(sql).toContain("'orders', 'edit'");
    expect(sql).toContain('CREATE POLICY merchant_shipping_charges_owner_read');
  });

  it('replaces every owner-only wallet charge RPC', () => {
    for (const functionName of [
      'reserve_merchant_shipping_charge',
      'begin_merchant_shipping_charge_submission',
      'complete_merchant_shipping_charge',
      'refund_merchant_shipping_charge',
      'mark_merchant_shipping_charge_for_reconciliation',
    ]) {
      expect(sql).toContain(
        `CREATE OR REPLACE FUNCTION public.${functionName}`
      );
    }
    expect(sql).not.toContain('m.user_id = auth.uid()');
    expect(sql).toContain(
      'v_existing.id IS NULL AND v_quote.expires_at <= now()'
    );
  });

  it('keeps token checks and completion shipment binding intact', () => {
    expect(sql).toContain('c.attempt_token_digest = v_digest');
    expect(sql).toContain('v_charge.attempt_token_digest <>');
    expect(sql).toContain('s.order_id = v_charge.order_id');
    expect(sql).toContain('s.shipping_quote_id = v_charge.shipping_quote_id');
    expect(sql).toContain("s.provider = 'GIGL'");
    expect(sql).toContain("RAISE EXCEPTION 'shipment_binding_mismatch'");
  });
});
