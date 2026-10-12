import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { resolveIdempotentOfferReplay } from './resolve-idempotent-offer-replay';

const MERCHANT_ID = '11111111-1111-1111-1111-111111111111';
const PRODUCT_ID = '22222222-2222-2222-2222-222222222222';
const OFFER_ID = '33333333-3333-3333-3333-333333333333';

const offerLine = {
  product_id: PRODUCT_ID,
  offer_id: OFFER_ID,
  condition: 'refurbished',
};

function clients({
  probeHit,
  offers,
  storedTax,
  storedTaxError = null,
}: {
  probeHit: boolean;
  offers: unknown;
  storedTax: unknown;
  storedTaxError?: unknown;
}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'has_storefront_order_idempotency_key') {
      return { data: probeHit, error: null };
    }
    if (name === 'get_storefront_order_replay_economics') {
      return { data: storedTax, error: storedTaxError };
    }
    return { data: offers, error: null };
  });

  return {
    rpc,
    supabase: { rpc } as unknown as SupabaseClient,
  };
}

const liveOffers = [
  {
    offer_id: OFFER_ID,
    condition: 'refurbished',
    price: 400000,
  },
];

describe('resolveIdempotentOfferReplay', () => {
  it('verifies against live offers for a fresh order', async () => {
    const c = clients({ probeHit: false, offers: liveOffers, storedTax: null });

    const result = await resolveIdempotentOfferReplay({
      merchantId: MERCHANT_ID,
      orderItemsPayload: [offerLine],
      requestIdempotencyKey: 'checkout-1',
      supabase: c.supabase,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.isIdempotentOfferOrderReplay).toBe(false);
    expect(result.value.liveOfferPrices.get(`${PRODUCT_ID}::${OFFER_ID}`)).toBe(
      400000
    );
    expect(result.value.storedReplayTaxAmount).toBeNull();
    expect(c.rpc).not.toHaveBeenCalledWith(
      'get_storefront_order_replay_economics',
      expect.anything()
    );
  });

  it('skips live verification and reuses stored tax on a replay hit', async () => {
    const c = clients({
      probeHit: true,
      offers: [],
      storedTax: [{ tax_amount: 30000, items: [] }],
    });

    const result = await resolveIdempotentOfferReplay({
      merchantId: MERCHANT_ID,
      orderItemsPayload: [offerLine],
      requestIdempotencyKey: 'checkout-1',
      supabase: c.supabase,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.isIdempotentOfferOrderReplay).toBe(true);
    expect(result.value.liveOfferPrices.size).toBe(0);
    expect(result.value.storedReplayTaxAmount).toBe(30000);
    expect(c.rpc).not.toHaveBeenCalledWith(
      'get_product_offers',
      expect.anything()
    );
    expect(c.rpc).toHaveBeenCalledWith(
      'get_storefront_order_replay_economics',
      expect.objectContaining({ p_checkout_idempotency_key: 'checkout-1' })
    );
  });

  it('restores the stored line condition on a replay hit', async () => {
    const c = clients({
      probeHit: true,
      offers: [],
      storedTax: [
        {
          tax_amount: 30000,
          items: [
            {
              product_id: PRODUCT_ID,
              offer_id: OFFER_ID,
              condition: 'refurbished',
            },
          ],
        },
      ],
    });
    // The retry carries the canonical alias; the first attempt hashed the
    // live offer spelling, so the payload must be rewritten to match.
    const payload = [{ ...offerLine, condition: 'open_box' }];

    const result = await resolveIdempotentOfferReplay({
      merchantId: MERCHANT_ID,
      orderItemsPayload: payload,
      requestIdempotencyKey: 'checkout-1',
      supabase: c.supabase,
    });

    expect(result.ok).toBe(true);
    expect(payload[0].condition).toBe('refurbished');
  });

  it('leaves unmatched lines on a replay hit (fail-open per line)', async () => {
    const c = clients({
      probeHit: true,
      offers: [],
      storedTax: [{ tax_amount: 30000, items: [] }],
    });
    const payload = [{ ...offerLine, condition: 'open_box' }];

    const result = await resolveIdempotentOfferReplay({
      merchantId: MERCHANT_ID,
      orderItemsPayload: payload,
      requestIdempotencyKey: 'checkout-1',
      supabase: c.supabase,
    });

    expect(result.ok).toBe(true);
    expect(payload[0].condition).toBe('open_box');
  });

  it('accepts a string-decoded stored tax from PostgREST numerics', async () => {
    const c = clients({
      probeHit: true,
      offers: [],
      storedTax: [{ tax_amount: '30000.00', items: [] }],
    });

    const result = await resolveIdempotentOfferReplay({
      merchantId: MERCHANT_ID,
      orderItemsPayload: [offerLine],
      requestIdempotencyKey: 'checkout-1',
      supabase: c.supabase,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storedReplayTaxAmount).toBe(30000);
  });

  it('fails open to a VAT recompute when the stored-tax read fails', async () => {
    const c = clients({
      probeHit: true,
      offers: [],
      storedTax: null,
      storedTaxError: new Error('read replica lagging'),
    });

    const result = await resolveIdempotentOfferReplay({
      merchantId: MERCHANT_ID,
      orderItemsPayload: [offerLine],
      requestIdempotencyKey: 'checkout-1',
      supabase: c.supabase,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.isIdempotentOfferOrderReplay).toBe(true);
    expect(result.value.storedReplayTaxAmount).toBeNull();
  });

  it('rejects a dead offer on a fresh order instead of replaying', async () => {
    const c = clients({ probeHit: false, offers: [], storedTax: null });

    const result = await resolveIdempotentOfferReplay({
      merchantId: MERCHANT_ID,
      orderItemsPayload: [offerLine],
      requestIdempotencyKey: 'checkout-1',
      supabase: c.supabase,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_offer' });
  });

  it('skips the probe when no idempotency key or offer lines exist', async () => {
    const c = clients({ probeHit: false, offers: [], storedTax: null });

    const noKey = await resolveIdempotentOfferReplay({
      merchantId: MERCHANT_ID,
      orderItemsPayload: [offerLine],
      requestIdempotencyKey: null,
      supabase: c.supabase,
    });
    const noOffers = await resolveIdempotentOfferReplay({
      merchantId: MERCHANT_ID,
      orderItemsPayload: [{ product_id: PRODUCT_ID }],
      requestIdempotencyKey: 'checkout-1',
      supabase: c.supabase,
    });

    expect(c.rpc).not.toHaveBeenCalledWith(
      'has_storefront_order_idempotency_key',
      expect.anything()
    );
    expect(noKey.ok && noKey.value.isIdempotentOfferOrderReplay).toBe(false);
    expect(noOffers.ok && noOffers.value.isIdempotentOfferOrderReplay).toBe(
      false
    );
  });
});
