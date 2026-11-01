import { describe, expect, it, vi } from 'vitest';
import { fetchCartOfferPrices } from './cart-offer-prices';
import { CART_TEST_MERCHANT_ID } from './cart-product-owner.test-support';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '55555555-5555-4555-8555-555555555555';

describe('fetchCartOfferPrices', () => {
  it('maps live offers per product and skips variant lines', async () => {
    const callRpc = vi.fn(async () => ({
      data: [
        {
          product_id: PRODUCT_ID,
          offer_id: OFFER_ID,
          price_basis: 400_000,
          condition: 'used',
          allocatable_stock: 3,
          parent_eligible: true,
        },
      ],
      error: null,
    }));

    const offerMap = await fetchCartOfferPrices(
      callRpc,
      [
        { id: PRODUCT_ID, offerId: OFFER_ID },
        { id: PRODUCT_ID, variantId: 'v1', offerId: OFFER_ID },
        { id: PRODUCT_ID },
        { id: 'not-a-uuid', offerId: OFFER_ID },
      ],
      [{ id: PRODUCT_ID, merchant_id: CART_TEST_MERCHANT_ID }]
    );

    expect(callRpc).toHaveBeenCalledTimes(1);
    expect(callRpc).toHaveBeenCalledWith({
      p_merchant_id: CART_TEST_MERCHANT_ID,
      p_product_ids: [PRODUCT_ID],
    });
    expect(offerMap.get(`${PRODUCT_ID}::${OFFER_ID}`)).toEqual({
      offer_id: OFFER_ID,
      price: 400_000,
      condition: 'used',
      stock_quantity: 3,
      parent_eligible: true,
    });
  });

  it('throws the first offer query error for the route to report', async () => {
    const callRpc = vi.fn(async () => ({
      data: null,
      error: { message: 'offer query failed' },
    }));

    await expect(
      fetchCartOfferPrices(
        callRpc,
        [{ id: PRODUCT_ID, offerId: OFFER_ID }],
        [{ id: PRODUCT_ID, merchant_id: CART_TEST_MERCHANT_ID }]
      )
    ).rejects.toThrow('offer query failed');
  });

  it('fetches merchant groups concurrently with a bounded number in flight', async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const callRpc = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return { data: [], error: null };
    });
    const products = Array.from({ length: 7 }, (_, i) => ({
      id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
      merchant_id: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`,
    }));
    const work = fetchCartOfferPrices(
      callRpc,
      products.map(({ id }) => ({ id, offerId: OFFER_ID })),
      products
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callRpc).toHaveBeenCalledTimes(5);
    expect(peak).toBe(5);
    for (const release of releases.splice(0)) release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callRpc).toHaveBeenCalledTimes(7);
    for (const release of releases.splice(0)) release();
    await expect(work).resolves.toEqual(new Map());
    expect(peak).toBeLessThanOrEqual(5);
  });

  it('batches many products into one authority call', async () => {
    const productIds = Array.from(
      { length: 25 },
      (_, index) =>
        `11111111-1111-4111-8111-${index.toString(16).padStart(12, '0')}`
    );
    const callRpc = vi.fn(async () => ({ data: [], error: null }));

    const offerMap = await fetchCartOfferPrices(
      callRpc,
      productIds.map((id) => ({ id, offerId: OFFER_ID })),
      productIds.map((id) => ({ id, merchant_id: CART_TEST_MERCHANT_ID }))
    );

    expect(callRpc).toHaveBeenCalledTimes(1);
    expect(callRpc).toHaveBeenCalledWith({
      p_merchant_id: CART_TEST_MERCHANT_ID,
      p_product_ids: productIds,
    });
    expect(offerMap.size).toBe(0);
  });
});
