import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260901192000_add_merchant_shipping_charges.sql`,
  'utf8'
);
const completionSql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260901203000_harden_shipping_charge_completion.sql`,
  'utf8'
);

describe('merchant shipping charge migration contract', () => {
  const ownerFunctions = [
    'reserve_merchant_shipping_charge',
    'begin_merchant_shipping_charge_submission',
    'complete_merchant_shipping_charge',
    'refund_merchant_shipping_charge',
    'mark_merchant_shipping_charge_for_reconciliation',
  ];

  it('defines the owner-checked idempotent charge ledger and five RPCs', () => {
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS public.merchant_shipping_charges'
    );
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS provider_cost numeric(12,2)'
    );
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS platform_margin numeric(12,2)'
    );
    expect(sql).toContain('shipments_provider_cost_nonnegative');
    expect(sql).toContain('shipments_platform_margin_nonnegative');
    expect(sql).toContain('UNIQUE(order_id, shipping_quote_id)');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain(
      'm.id = merchant_shipping_charges.merchant_id\n        AND m.user_id = auth.uid()'
    );
    expect(sql).not.toMatch(/merchant_id\s*=\s*auth\.uid\(\)/);
    expect(sql).toContain("provider='GIGL'");
    expect(sql).toContain("currency='NGN'");
    expect(sql).toContain(
      "shipping_funding_source IS DISTINCT FROM 'merchant_wallet'"
    );
    expect(sql).toContain("'gigl_shipping'");
    expect(sql).toContain('MERCHANT_WALLET_INSUFFICIENT');
    expect(sql).toContain("extensions.digest(p_attempt_token,'sha256')");
    for (const fn of ownerFunctions)
      expect(sql).toContain(`FUNCTION public.${fn}`);
  });

  it('uses the merchants ownership join in every owner-sensitive RPC', () => {
    for (const fn of ownerFunctions) {
      const start = sql.indexOf(`FUNCTION public.${fn}`);
      const end = sql.indexOf('END; $$;', start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      const body = sql.slice(start, end);
      expect(body).toMatch(
        /m\.id\s*=\s*(?:v_order\.merchant_id|c\.merchant_id|msc\.merchant_id)\s+AND\s+m\.user_id\s*=\s*auth\.uid\(\)/s
      );
      expect(body).not.toMatch(/(?:^|\W)merchant_id\s*=\s*auth\.uid\(\)/);
    }
  });

  it('locks the order by id before checking ownership and wallet funding', () => {
    const reserve = sql.slice(
      sql.indexOf('FUNCTION public.reserve_merchant_shipping_charge')
    );
    expect(reserve).toContain(
      'FROM public.orders WHERE id=p_order_id FOR SHARE'
    );
    expect(
      reserve.indexOf('FROM public.orders WHERE id=p_order_id FOR SHARE')
    ).toBeLessThan(reserve.indexOf('m.id = v_order.merchant_id'));
    expect(reserve).toContain(
      "v_order.shipping_funding_source IS DISTINCT FROM 'merchant_wallet'"
    );
  });

  it('models the ownership boundary: only the merchant user may transition a charge', () => {
    const merchantRows = [
      { id: 'merchant-a', user_id: 'user-a' },
      { id: 'merchant-b', user_id: 'user-b' },
    ];
    const charge = { merchant_id: 'merchant-a' };
    const ownsCharge = (authUserId: string) =>
      merchantRows.some(
        (merchant) =>
          merchant.id === charge.merchant_id && merchant.user_id === authUserId
      );

    expect(ownsCharge('user-a')).toBe(true);
    expect(ownsCharge('user-b')).toBe(false);
    expect(ownsCharge('merchant-a')).toBe(false);
  });

  it('preserves token-gated transitions and terminal idempotency', () => {
    expect(sql).toMatch(/attempt_token_digest\s*=\s*d/);
    expect(sql).toContain(
      "IF c.attempt_token_digest <> pg_catalog.encode(extensions.digest(p_attempt_token,'sha256'),'hex')"
    );
    expect(sql).toContain(
      "IF v='reserved' THEN UPDATE public.merchant_shipping_charges SET status='provider_submitting'"
    );
    expect(sql).toContain(
      "IF v = 'provider_submitting' THEN UPDATE public.merchant_shipping_charges SET status='booked'"
    );
    expect(sql).toContain("status='needs_reconciliation'");
  });

  it('checks the refund token before refunded terminal idempotency', () => {
    const refund = sql.slice(
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION public.refund_merchant_shipping_charge'
      )
    );
    expect(refund.indexOf('attempt_token_digest <>')).toBeLessThan(
      refund.indexOf("status='refunded'")
    );
  });

  it('requires a same-order, same-merchant GIGL shipment before completion', () => {
    expect(completionSql).toContain(
      'CREATE OR REPLACE FUNCTION public.complete_merchant_shipping_charge'
    );
    for (const expression of [
      'm.id = msc.merchant_id',
      'm.user_id = auth.uid()',
      'msc.attempt_token_digest = v_digest',
      "IF v_charge.status = 'provider_submitting' THEN",
      's.merchant_id = v_charge.merchant_id',
      's.order_id = v_charge.order_id',
      's.shipping_quote_id = v_charge.shipping_quote_id',
      "s.provider = 'GIGL'",
      "RAISE EXCEPTION 'shipment_binding_mismatch'",
    ]) {
      expect(completionSql).toContain(expression);
    }
    expect(
      completionSql.indexOf("RAISE EXCEPTION 'shipment_binding_mismatch'")
    ).toBeLessThan(completionSql.indexOf("SET status = 'booked'"));
  });

  it('models completion rejection for an unrelated shipment', () => {
    const charge = {
      merchantId: 'merchant-a',
      orderId: 'order-a',
      shippingQuoteId: 'quote-a',
    };
    const shipmentMatches = (shipment: {
      merchantId: string;
      orderId: string;
      shippingQuoteId: string;
      provider: string;
    }) =>
      shipment.merchantId === charge.merchantId &&
      shipment.orderId === charge.orderId &&
      shipment.shippingQuoteId === charge.shippingQuoteId &&
      shipment.provider === 'GIGL';

    expect(
      shipmentMatches({
        merchantId: 'merchant-b',
        orderId: 'order-a',
        shippingQuoteId: 'quote-a',
        provider: 'GIGL',
      })
    ).toBe(false);
    expect(
      shipmentMatches({
        merchantId: 'merchant-a',
        orderId: 'order-b',
        shippingQuoteId: 'quote-a',
        provider: 'GIGL',
      })
    ).toBe(false);
    expect(
      shipmentMatches({
        merchantId: 'merchant-a',
        orderId: 'order-a',
        shippingQuoteId: 'quote-b',
        provider: 'GIGL',
      })
    ).toBe(false);
    expect(
      shipmentMatches({
        merchantId: 'merchant-a',
        orderId: 'order-a',
        shippingQuoteId: 'quote-a',
        provider: 'TOPSHIP',
      })
    ).toBe(false);
    expect(
      shipmentMatches({
        merchantId: 'merchant-a',
        orderId: 'order-a',
        shippingQuoteId: 'quote-a',
        provider: 'GIGL',
      })
    ).toBe(true);
  });
});
