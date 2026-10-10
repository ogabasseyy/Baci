import { describe, expect, it, vi } from 'vitest';
import { resolveOrderOfferEconomics } from './resolve-order-offer-economics';
import type { OrderOfferQueryResult } from './verify-order-offer-lines';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_OFFER_ID = '33333333-3333-4333-8333-333333333333';
const LIVE_KEY = `${PRODUCT_ID}::${OFFER_ID}`;

function buildExecutor(
  rowsByProduct: Record<string, OrderOfferQueryResult['data']>
) {
  return vi.fn(async (productId: string) => ({
    data: rowsByProduct[productId] ?? [],
    error: null,
  }));
}

describe('resolveOrderOfferEconomics', () => {
  it('returns empty maps without a lookup when no line names an offer', async () => {
    const fetchOffers = buildExecutor({});
    const items = [{ product_id: PRODUCT_ID, condition: 'new' }];

    const result = await resolveOrderOfferEconomics(fetchOffers, items);

    expect(result).toEqual({
      ok: true,
      liveOfferPrices: new Map(),
      liveOfferConditions: new Map(),
    });
    expect(fetchOffers).not.toHaveBeenCalled();
  });

  it('verifies offer lines and persists the live merchant condition', async () => {
    const fetchOffers = buildExecutor({
      [PRODUCT_ID]: [{ offer_id: OFFER_ID, price: 800, condition: 'open_box' }],
    });
    const items = [
      { product_id: PRODUCT_ID, offer_id: OFFER_ID, condition: null },
    ];

    const result = await resolveOrderOfferEconomics(fetchOffers, items);

    expect(result).toEqual({
      ok: true,
      liveOfferPrices: new Map([[LIVE_KEY, 800]]),
      liveOfferConditions: new Map([[LIVE_KEY, 'open_box']]),
    });
    expect(items[0]?.condition).toBe('open_box');
  });

  it('accepts a caller spelling that canonicalizes to the live condition', async () => {
    const fetchOffers = buildExecutor({
      [PRODUCT_ID]: [{ offer_id: OFFER_ID, price: 800, condition: 'open_box' }],
    });
    const items = [
      { product_id: PRODUCT_ID, offer_id: OFFER_ID, condition: 'Open Box' },
    ];

    const result = await resolveOrderOfferEconomics(fetchOffers, items);

    expect(result.ok).toBe(true);
    expect(items[0]?.condition).toBe('open_box');
  });

  it('rejects a caller condition that names another condition', async () => {
    const fetchOffers = buildExecutor({
      [PRODUCT_ID]: [{ offer_id: OFFER_ID, price: 800, condition: 'used' }],
    });
    const items = [
      { product_id: PRODUCT_ID, offer_id: OFFER_ID, condition: 'new' },
    ];

    await expect(
      resolveOrderOfferEconomics(fetchOffers, items)
    ).resolves.toEqual({ ok: false, reason: 'invalid_offer' });
  });

  it('rejects an offer that is not live for its product', async () => {
    const fetchOffers = buildExecutor({ [PRODUCT_ID]: [] });
    const items = [{ product_id: PRODUCT_ID, offer_id: OTHER_OFFER_ID }];

    await expect(
      resolveOrderOfferEconomics(fetchOffers, items)
    ).resolves.toEqual({ ok: false, reason: 'invalid_offer' });
  });

  it('rejects a live row without a condition rather than persisting a label', async () => {
    const fetchOffers = buildExecutor({
      [PRODUCT_ID]: [{ offer_id: OFFER_ID, price: 800, condition: null }],
    });
    const items = [{ product_id: PRODUCT_ID, offer_id: OFFER_ID }];

    await expect(
      resolveOrderOfferEconomics(fetchOffers, items)
    ).resolves.toEqual({ ok: false, reason: 'invalid_offer' });
  });

  it('reports lookup failures for the route to map to a 500', async () => {
    const failure = new Error('boom');
    const fetchOffers = vi.fn(async () => {
      throw failure;
    });
    const items = [{ product_id: PRODUCT_ID, offer_id: OFFER_ID }];

    await expect(
      resolveOrderOfferEconomics(fetchOffers, items)
    ).resolves.toEqual({
      ok: false,
      reason: 'verification_failed',
      error: failure,
    });
  });
});
