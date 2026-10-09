import { describe, expect, it, vi } from 'vitest';
import { findMismatchedOrderOffer } from './verify-order-offer-lines';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_OFFER_ID = '66666666-6666-4666-8666-666666666666';

describe('findMismatchedOrderOffer', () => {
  it('accepts lines whose offers are live for their own product', async () => {
    const fetchOffers = vi.fn(async () => ({
      data: [{ offer_id: OFFER_ID }, { offer_id: OTHER_OFFER_ID }],
      error: null,
    }));

    const mismatch = await findMismatchedOrderOffer(fetchOffers, [
      { product_id: PRODUCT_ID, offer_id: OFFER_ID },
      { product_id: PRODUCT_ID },
    ]);

    expect(mismatch).toBeNull();
    expect(fetchOffers).toHaveBeenCalledTimes(1);
    expect(fetchOffers).toHaveBeenCalledWith(PRODUCT_ID);
  });

  it('flags offers that are gone or belong to another product', async () => {
    const fetchOffers = vi.fn(async () => ({
      data: [{ offer_id: OFFER_ID }],
      error: null,
    }));

    const mismatch = await findMismatchedOrderOffer(fetchOffers, [
      { product_id: PRODUCT_ID, offer_id: OTHER_OFFER_ID },
    ]);

    expect(mismatch).toEqual({
      product_id: PRODUCT_ID,
      offer_id: OTHER_OFFER_ID,
    });
  });

  it('fails closed on malformed ids without querying', async () => {
    const fetchOffers = vi.fn(async () => ({ data: [], error: null }));

    const mismatch = await findMismatchedOrderOffer(fetchOffers, [
      { product_id: PRODUCT_ID, offer_id: 'not-a-uuid' },
    ]);

    expect(mismatch).toEqual({
      product_id: PRODUCT_ID,
      offer_id: 'not-a-uuid',
    });
    expect(fetchOffers).not.toHaveBeenCalled();
  });

  it('throws lookup errors for the route to report as a 500', async () => {
    const fetchOffers = vi.fn(async () => ({
      data: null,
      error: { message: 'offer lookup failed' },
    }));

    await expect(
      findMismatchedOrderOffer(fetchOffers, [
        { product_id: PRODUCT_ID, offer_id: OFFER_ID },
      ])
    ).rejects.toThrow('offer lookup failed');
  });
});
