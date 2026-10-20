import { describe, expect, it, vi } from 'vitest';
import { resolveOrderOfferEconomics } from './resolve-order-offer-economics';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_OFFER_ID = '33333333-3333-4333-8333-333333333333';
const LIVE_KEY = `${PRODUCT_ID}::${OFFER_ID}`;

function authorityRow(offerId: string, extra: Record<string, unknown> = {}) {
  return {
    product_id: PRODUCT_ID,
    offer_id: offerId,
    condition: 'open_box',
    price_basis: 800,
    allocatable_stock: 3,
    parent_eligible: true,
    ...extra,
  };
}

function buildExecutor(rows: Record<string, Record<string, unknown>[]>) {
  return vi.fn(async () => ({
    data: Object.values(rows).flat(),
    error: null,
  }));
}

describe('resolveOrderOfferEconomics', () => {
  it('returns empty maps without a lookup when no line names an offer', async () => {
    const callRpc = buildExecutor({});
    const items = [{ product_id: PRODUCT_ID, condition: 'new' }];

    const result = await resolveOrderOfferEconomics(callRpc, items);

    expect(result).toEqual({
      ok: true,
      liveOfferPrices: new Map(),
      liveOfferConditions: new Map(),
    });
    expect(callRpc).not.toHaveBeenCalled();
  });

  it('verifies offer lines and persists the live merchant condition', async () => {
    const callRpc = buildExecutor({
      [PRODUCT_ID]: [authorityRow(OFFER_ID)],
    });
    const items = [
      { product_id: PRODUCT_ID, offer_id: OFFER_ID, condition: null },
    ];

    const result = await resolveOrderOfferEconomics(callRpc, items);

    expect(result).toEqual({
      ok: true,
      liveOfferPrices: new Map([[LIVE_KEY, 800]]),
      liveOfferConditions: new Map([[LIVE_KEY, 'open_box']]),
    });
    expect(items[0]?.condition).toBe('open_box');
  });

  it('accepts a caller spelling that canonicalizes to the live condition', async () => {
    const callRpc = buildExecutor({
      [PRODUCT_ID]: [authorityRow(OFFER_ID)],
    });
    const items = [
      { product_id: PRODUCT_ID, offer_id: OFFER_ID, condition: 'Open Box' },
    ];

    const result = await resolveOrderOfferEconomics(callRpc, items);

    expect(result.ok).toBe(true);
    expect(items[0]?.condition).toBe('open_box');
  });

  it('rejects a caller condition that names another condition', async () => {
    const callRpc = buildExecutor({
      [PRODUCT_ID]: [authorityRow(OFFER_ID, { condition: 'used' })],
    });
    const items = [
      { product_id: PRODUCT_ID, offer_id: OFFER_ID, condition: 'new' },
    ];

    await expect(resolveOrderOfferEconomics(callRpc, items)).resolves.toEqual({
      ok: false,
      reason: 'invalid_offer',
    });
  });

  it('rejects an offer that is not live for its product', async () => {
    const callRpc = buildExecutor({ [PRODUCT_ID]: [] });
    const items = [{ product_id: PRODUCT_ID, offer_id: OTHER_OFFER_ID }];

    await expect(resolveOrderOfferEconomics(callRpc, items)).resolves.toEqual({
      ok: false,
      reason: 'invalid_offer',
    });
  });

  it('rejects a live row without a condition rather than persisting a label', async () => {
    const callRpc = buildExecutor({
      [PRODUCT_ID]: [authorityRow(OFFER_ID, { condition: null })],
    });
    const items = [{ product_id: PRODUCT_ID, offer_id: OFFER_ID }];

    await expect(resolveOrderOfferEconomics(callRpc, items)).resolves.toEqual({
      ok: false,
      reason: 'invalid_offer',
    });
  });

  it('reports lookup failures for the route to map to a 500', async () => {
    const failure = new Error('boom');
    const callRpc = vi.fn(async () => {
      throw failure;
    });
    const items = [{ product_id: PRODUCT_ID, offer_id: OFFER_ID }];

    await expect(resolveOrderOfferEconomics(callRpc, items)).resolves.toEqual({
      ok: false,
      reason: 'verification_failed',
      error: failure,
    });
  });
});
