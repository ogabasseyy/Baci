import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903128000_serialize_gigl_wallet_cancellation_and_restrict_economics.sql`,
  'utf8'
);

describe('GIGL wallet cancellation/economics migration', () => {
  it('serializes reservation before checking processing and cancellation state', () => {
    const lock = sql.indexOf("'merchant-shipping-order:' || p_order_id");
    const orderRead = sql.indexOf('SELECT * INTO v_order');
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(orderRead).toBeGreaterThan(lock);
    expect(sql).toContain(
      "lower(COALESCE(v_order.shipping_status, '')) IS DISTINCT FROM 'processing'"
    );
    expect(sql).toContain('OR v_order.cancelled_at IS NOT NULL THEN');
    expect(sql).toContain('FOR UPDATE;');
  });

  it('keeps checkout retention immutable when address edits clear quote binding', () => {
    expect(sql).toContain(
      "IF TG_OP = 'UPDATE' AND OLD.shipping_funding_source = 'customer_checkout' THEN"
    );
    expect(sql).toContain(
      "NEW.shipping_funding_source := 'customer_checkout';"
    );
    expect(sql).toContain(
      'NEW.shipping_platform_retained_amount := OLD.shipping_platform_retained_amount;'
    );
  });

  it('rejects cancellation while booking or an unsubmitted wallet charge is active', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.prevent_active_gigl_shipping_cancellation()'
    );
    expect(sql).toContain("'active_shipment_booking_lock'");
    expect(sql).toContain("'active_merchant_shipping_charge'");
    expect(sql).toContain(
      "charge.status IN ('reserved', 'provider_submitting')"
    );
    expect(sql).toContain('BEFORE UPDATE OF shipping_status ON public.orders');
  });

  it('keeps bundled prices readable but excludes provider economics', () => {
    expect(sql).toContain(
      'REVOKE SELECT ON TABLE public.shipments, public.merchant_shipping_charges FROM authenticated;'
    );
    expect(sql).toContain('price, currency, status');
    expect(sql).toContain('charged_amount');
    const shipmentGrantStart = sql.indexOf(
      'GRANT SELECT (\n  id, order_id, merchant_id, provider'
    );
    const chargeGrantStart = sql.indexOf(
      'GRANT SELECT (\n  id, merchant_id, order_id'
    );
    const shipmentGrant = sql.slice(shipmentGrantStart, chargeGrantStart);
    const chargeGrant = sql.slice(
      chargeGrantStart,
      sql.indexOf('COMMENT ON COLUMN')
    );
    expect(shipmentGrant).not.toContain('provider_cost');
    expect(shipmentGrant).not.toContain('platform_margin');
    expect(chargeGrant).not.toContain('provider_cost');
    expect(chargeGrant).not.toContain('platform_margin');
  });
});
