import { describe, expect, it, vi } from 'vitest';
import { fetchCartOfferPrices } from './cart-offer-prices';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '55555555-5555-4555-8555-555555555555';

describe('fetchCartOfferPrices', () => {
  it('maps live offers per product and skips variant lines', async () => {
    const fetchOffers = vi.fn(async () => ({
      data: [{ offer_id: OFFER_ID, price: 400_000 }],
      error: null,
    }));

    const offerMap = await fetchCartOfferPrices(fetchOffers, [
      { id: PRODUCT_ID, offerId: OFFER_ID },
      { id: PRODUCT_ID, variantId: 'v1', offerId: OFFER_ID },
      { id: PRODUCT_ID },
      { id: 'not-a-uuid', offerId: OFFER_ID },
    ]);

    expect(fetchOffers).toHaveBeenCalledTimes(1);
    expect(fetchOffers).toHaveBeenCalledWith(PRODUCT_ID);
    expect(offerMap.get(`${PRODUCT_ID}::${OFFER_ID}`)).toEqual({
      offer_id: OFFER_ID,
      price: 400_000,
    });
  });

  it('throws the first offer query error for the route to report', async () => {
    const fetchOffers = vi.fn(async () => ({
      data: null,
      error: { message: 'offer query failed' },
    }));

    await expect(
      fetchCartOfferPrices(fetchOffers, [{ id: PRODUCT_ID, offerId: OFFER_ID }])
    ).rejects.toThrow('offer query failed');
  });

  it('bounds concurrent offer lookups across many products', async () => {
    const productIds = Array.from(
      { length: 25 },
      (_, index) =>
        `11111111-1111-4111-8111-${index.toString(16).padStart(12, '0')}`
    );
    let active = 0;
    let maxActive = 0;
    const fetchOffers = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { data: [], error: null };
    });

    const offerMap = await fetchCartOfferPrices(
      fetchOffers,
      productIds.map((id) => ({ id, offerId: OFFER_ID }))
    );

    expect(fetchOffers).toHaveBeenCalledTimes(25);
    expect(maxActive).toBeLessThanOrEqual(10);
    expect(offerMap.size).toBe(0);
  });
});
