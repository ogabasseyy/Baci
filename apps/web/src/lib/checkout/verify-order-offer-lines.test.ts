import { describe, expect, it, vi } from 'vitest';
import {
  fetchLiveOrderOffers,
  findMismatchedOrderOffer,
} from './verify-order-offer-lines';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_OFFER_ID = '66666666-6666-4666-8666-666666666666';
const MERCHANT_ID = '77777777-7777-4777-8777-777777777777';

function authorityRow(offerId: string, extra: Record<string, unknown> = {}) {
  return {
    product_id: PRODUCT_ID,
    offer_id: offerId,
    condition: 'used',
    price_basis: 400_000,
    allocatable_stock: 3,
    parent_eligible: true,
    ...extra,
  };
}

describe('findMismatchedOrderOffer', () => {
  it('accepts lines whose offers are live for their own product', async () => {
    const callRpc = vi.fn(async () => ({
      data: [authorityRow(OFFER_ID), authorityRow(OTHER_OFFER_ID)],
      error: null,
    }));

    const mismatch = await findMismatchedOrderOffer(
      callRpc,
      [
        { product_id: PRODUCT_ID, offer_id: OFFER_ID },
        { product_id: PRODUCT_ID },
      ],
      MERCHANT_ID
    );

    expect(mismatch).toBeNull();
    expect(callRpc).toHaveBeenCalledTimes(1);
    expect(callRpc).toHaveBeenCalledWith({
      p_merchant_id: MERCHANT_ID,
      p_product_ids: [PRODUCT_ID],
    });
  });

  it('flags live but parent-ineligible offers and hides their economics', async () => {
    const callRpc = vi.fn(async () => ({
      data: [authorityRow(OFFER_ID, { parent_eligible: false })],
      error: null,
    }));

    const line = { product_id: PRODUCT_ID, offer_id: OFFER_ID };
    expect(await findMismatchedOrderOffer(callRpc, [line])).toEqual(line);

    const live = await fetchLiveOrderOffers(callRpc, [line]);
    expect(live.mismatch).toEqual(line);
    expect(live.prices.size).toBe(0);
    expect(live.conditions.size).toBe(0);
  });

  it('flags offers that are gone or belong to another product', async () => {
    const callRpc = vi.fn(async () => ({
      data: [authorityRow(OFFER_ID)],
      error: null,
    }));

    const mismatch = await findMismatchedOrderOffer(callRpc, [
      { product_id: PRODUCT_ID, offer_id: OTHER_OFFER_ID },
    ]);

    expect(mismatch).toEqual({
      product_id: PRODUCT_ID,
      offer_id: OTHER_OFFER_ID,
    });
  });

  it('fails closed on malformed ids without querying', async () => {
    const callRpc = vi.fn(async () => ({ data: [], error: null }));

    const mismatch = await findMismatchedOrderOffer(callRpc, [
      { product_id: PRODUCT_ID, offer_id: 'not-a-uuid' },
    ]);

    expect(mismatch).toEqual({
      product_id: PRODUCT_ID,
      offer_id: 'not-a-uuid',
    });
    expect(callRpc).not.toHaveBeenCalled();
  });

  it('throws lookup errors for the route to report as a 500', async () => {
    const callRpc = vi.fn(async () => ({
      data: null,
      error: { message: 'offer lookup failed' },
    }));

    await expect(
      findMismatchedOrderOffer(callRpc, [
        { product_id: PRODUCT_ID, offer_id: OFFER_ID },
      ])
    ).rejects.toThrow('offer lookup failed');
  });
});

describe('fetchLiveOrderOffers', () => {
  it('returns the live price map alongside the mismatch check', async () => {
    const callRpc = vi.fn(async () => ({
      data: [
        authorityRow(OFFER_ID, { price_basis: 400_000 }),
        authorityRow(OTHER_OFFER_ID, { price_basis: '420000' }),
      ],
      error: null,
    }));

    const { mismatch, prices } = await fetchLiveOrderOffers(callRpc, [
      { product_id: PRODUCT_ID, offer_id: OFFER_ID },
    ]);

    expect(mismatch).toBeNull();
    expect(callRpc).toHaveBeenCalledTimes(1);
    expect(prices.get(`${PRODUCT_ID}::${OFFER_ID}`)).toBe(400_000);
    expect(prices.get(`${PRODUCT_ID}::${OTHER_OFFER_ID}`)).toBe(420_000);
  });

  it('omits unpriced rows from the map but keeps them live', async () => {
    const callRpc = vi.fn(async () => ({
      data: [authorityRow(OFFER_ID, { price_basis: null })],
      error: null,
    }));

    const { mismatch, prices } = await fetchLiveOrderOffers(callRpc, [
      { product_id: PRODUCT_ID, offer_id: OFFER_ID },
    ]);

    expect(mismatch).toBeNull();
    expect(prices.size).toBe(0);
  });

  it('returns the live condition map in raw merchant spellings', async () => {
    const callRpc = vi.fn(async () => ({
      data: [
        authorityRow(OFFER_ID, {
          price_basis: 400_000,
          condition: 'refurbished',
        }),
        authorityRow(OTHER_OFFER_ID, {
          price_basis: '420000',
          condition: null,
        }),
      ],
      error: null,
    }));

    const { mismatch, conditions } = await fetchLiveOrderOffers(callRpc, [
      { product_id: PRODUCT_ID, offer_id: OFFER_ID },
    ]);

    expect(mismatch).toBeNull();
    expect(conditions.get(`${PRODUCT_ID}::${OFFER_ID}`)).toBe('refurbished');
    expect(conditions.has(`${PRODUCT_ID}::${OTHER_OFFER_ID}`)).toBe(false);
  });

  it('batches many products into one authority call', async () => {
    const productIds = Array.from(
      { length: 25 },
      (_, index) =>
        `11111111-1111-4111-8111-${index.toString(16).padStart(12, '0')}`
    );
    const callRpc = vi.fn(async () => ({ data: [], error: null }));

    const { mismatch } = await fetchLiveOrderOffers(
      callRpc,
      productIds.map((product_id) => ({ product_id, offer_id: OFFER_ID }))
    );

    expect(callRpc).toHaveBeenCalledTimes(1);
    expect(callRpc).toHaveBeenCalledWith({
      p_merchant_id: null,
      p_product_ids: productIds,
    });
    expect(mismatch).not.toBeNull();
  });
});
