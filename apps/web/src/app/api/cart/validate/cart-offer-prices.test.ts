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
});
