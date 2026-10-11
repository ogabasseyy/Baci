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
    return { data: offers, error: null };
  });
  const maybeSingle = vi.fn().mockResolvedValue({
    data: storedTax,
    error: storedTaxError,
  });
  const chain = { eq: vi.fn().mockReturnThis(), maybeSingle };
  const from = vi.fn(() => ({
    select: vi.fn(() => chain),
  }));

  return {
    rpc,
    maybeSingle,
    from,
    supabase: { rpc } as unknown as SupabaseClient,
    adminSupabase: { from } as unknown as SupabaseClient,
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
      adminSupabase: c.adminSupabase,
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
    expect(c.from).not.toHaveBeenCalled();
  });

  it('skips live verification and reuses stored tax on a replay hit', async () => {
    const c = clients({
      probeHit: true,
      offers: [],
      storedTax: { tax_amount: 30000 },
    });

    const result = await resolveIdempotentOfferReplay({
      adminSupabase: c.adminSupabase,
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
    expect(c.from).toHaveBeenCalledWith('orders');
  });

  it('fails open to a VAT recompute when the stored-tax read fails', async () => {
    const c = clients({
      probeHit: true,
      offers: [],
      storedTax: null,
      storedTaxError: new Error('read replica lagging'),
    });

    const result = await resolveIdempotentOfferReplay({
      adminSupabase: c.adminSupabase,
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
      adminSupabase: c.adminSupabase,
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
      adminSupabase: c.adminSupabase,
      merchantId: MERCHANT_ID,
      orderItemsPayload: [offerLine],
      requestIdempotencyKey: null,
      supabase: c.supabase,
    });
    const noOffers = await resolveIdempotentOfferReplay({
      adminSupabase: c.adminSupabase,
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
