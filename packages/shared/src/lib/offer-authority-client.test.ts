import { describe, expect, it, vi } from 'vitest';
import {
  buildOfferResolutionMap,
  coerceOfferAuthorityRow,
  fetchOfferResolutions,
  OfferAuthorityInputError,
} from './offer-authority-client';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '22222222-2222-4222-8222-222222222222';

describe('coerceOfferAuthorityRow', () => {
  it('coerces PostgREST string numerics', () => {
    expect(
      coerceOfferAuthorityRow({
        product_id: PRODUCT_ID,
        offer_id: OFFER_ID,
        condition: 'used',
        price_basis: '80.5',
        allocatable_stock: '3',
        parent_eligible: true,
        effective_policy: 'legacy',
        available_units: null,
      })
    ).toEqual({
      productId: PRODUCT_ID,
      offerId: OFFER_ID,
      condition: 'used',
      priceBasis: 80.5,
      allocatableStock: 3,
      parentEligible: true,
      effectivePolicy: 'legacy',
      availableUnits: null,
      compareAtPrice: null,
      grade: null,
      conditionNotes: null,
      images: undefined,
    });
  });

  it('drops rows without an identity', () => {
    expect(coerceOfferAuthorityRow(null)).toBeNull();
    expect(coerceOfferAuthorityRow({ offer_id: OFFER_ID })).toBeNull();
    expect(
      coerceOfferAuthorityRow({ product_id: PRODUCT_ID, offer_id: '' })
    ).toBeNull();
  });

  it('fails closed when the eligibility flag is missing', () => {
    const row = coerceOfferAuthorityRow({
      product_id: PRODUCT_ID,
      offer_id: OFFER_ID,
      condition: 'used',
      price_basis: 80,
      allocatable_stock: 3,
    });
    expect(row?.parentEligible).toBe(false);
  });

  it('keeps gated-out rows with the flag off', () => {
    const row = coerceOfferAuthorityRow({
      product_id: PRODUCT_ID,
      offer_id: OFFER_ID,
      condition: 'used',
      price_basis: 80,
      allocatable_stock: 3,
      parent_eligible: false,
    });
    expect(row?.parentEligible).toBe(false);
    expect(row?.priceBasis).toBe(80);
  });
});

describe('buildOfferResolutionMap', () => {
  it('keys rows by product and offer', () => {
    const map = buildOfferResolutionMap([
      { product_id: PRODUCT_ID, offer_id: OFFER_ID, price_basis: 80 },
      null,
    ]);
    expect(map.get(`${PRODUCT_ID}::${OFFER_ID}`)?.priceBasis).toBe(80);
    expect(map.size).toBe(1);
  });

  it('returns an empty map for non-arrays', () => {
    expect(buildOfferResolutionMap(null).size).toBe(0);
  });
});

describe('fetchOfferResolutions', () => {
  it('batches product ids into a single call', async () => {
    const callRpc = vi.fn().mockResolvedValue({
      data: [{ product_id: PRODUCT_ID, offer_id: OFFER_ID, price_basis: 80 }],
      error: null,
    });
    const map = await fetchOfferResolutions(callRpc, {
      merchantId: 'm',
      productIds: [PRODUCT_ID, PRODUCT_ID],
    });
    expect(callRpc).toHaveBeenCalledTimes(1);
    expect(callRpc).toHaveBeenCalledWith({
      p_merchant_id: 'm',
      p_product_ids: [PRODUCT_ID],
    });
    expect(map.get(`${PRODUCT_ID}::${OFFER_ID}`)?.priceBasis).toBe(80);
  });

  it('chunks oversized batches across invocations and merges', async () => {
    const ids = Array.from(
      { length: 201 },
      (_, index) => `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`
    );
    const callRpc = vi.fn(async (args: { p_product_ids: string[] }) => ({
      data: args.p_product_ids.map((id) => ({
        product_id: id,
        offer_id: OFFER_ID,
        price_basis: 80,
      })),
      error: null,
    }));
    const map = await fetchOfferResolutions(callRpc, {
      merchantId: 'm',
      productIds: ids,
    });
    expect(callRpc).toHaveBeenCalledTimes(2);
    expect(callRpc.mock.calls[0][0].p_product_ids).toHaveLength(200);
    expect(callRpc.mock.calls[1][0].p_product_ids).toHaveLength(1);
    expect(map.size).toBe(201);
    expect(map.get(`${ids[200]}::${OFFER_ID}`)?.priceBasis).toBe(80);
  });

  it('skips the call when no ids are given', async () => {
    const callRpc = vi.fn();
    expect(await fetchOfferResolutions(callRpc, { productIds: [] })).toEqual(
      new Map()
    );
    expect(callRpc).not.toHaveBeenCalled();
  });

  it('fails closed on malformed ids without calling the RPC', async () => {
    const callRpc = vi.fn();
    await expect(
      fetchOfferResolutions(callRpc, { productIds: ['not-a-uuid'] })
    ).rejects.toBeInstanceOf(OfferAuthorityInputError);
    expect(callRpc).not.toHaveBeenCalled();
  });

  it('throws lookup errors for the caller to report', async () => {
    const callRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    });
    await expect(
      fetchOfferResolutions(callRpc, { productIds: [PRODUCT_ID] })
    ).rejects.toThrow('boom');
  });
});
