import { describe, expect, it, vi } from 'vitest';
import {
  buildOfferResolutionMap,
  coerceOfferAuthorityRow,
  fetchOfferResolutions,
  makeOfferLineKey,
  OfferAuthorityInputError,
  resolveOfferAllocatableStock,
  resolveOfferPriceBasis,
  selectConditionOffer,
  toFiniteOfferPrice,
} from './offer-authority';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '22222222-2222-4222-8222-222222222222';

describe('makeOfferLineKey', () => {
  it('keys resolutions by product and offer', () => {
    expect(makeOfferLineKey('p', 'o')).toBe('p::o');
  });
});

describe('toFiniteOfferPrice', () => {
  it('rejects blank values instead of pricing at zero', () => {
    expect(toFiniteOfferPrice(null)).toBeNull();
    expect(toFiniteOfferPrice(undefined)).toBeNull();
    expect(toFiniteOfferPrice('')).toBeNull();
    expect(toFiniteOfferPrice('abc')).toBeNull();
    expect(toFiniteOfferPrice('80.5')).toBe(80.5);
    expect(toFiniteOfferPrice(0)).toBe(0);
  });
});

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

describe('selectConditionOffer', () => {
  const offers = [
    { id: 'offer-refurbished', condition: 'refurbished', price: 510 },
    { id: 'offer-uk-used', condition: 'uk_used', price: 495 },
  ];

  it('matches canonical selections against legacy aliases', () => {
    expect(
      selectConditionOffer(offers, { selectedCondition: 'open_box' })
    ).toEqual(offers[0]);
    expect(selectConditionOffer(offers, { selectedCondition: 'used' })).toEqual(
      offers[1]
    );
  });

  it('prefers exact spellings only when requested', () => {
    const exact = { id: 'offer-open-box', condition: 'open_box', price: 525 };
    const candidates = [...offers, exact];
    expect(
      selectConditionOffer(candidates, {
        selectedCondition: 'open_box',
        preferExactConditionMatch: true,
      })
    ).toEqual(exact);
    expect(
      selectConditionOffer(candidates, { selectedCondition: 'open_box' })
    ).toEqual(offers[0]);
  });

  it('falls back to a single offer when no condition is selected', () => {
    const single = [offers[0]];
    expect(selectConditionOffer(single, {})).toEqual(single[0]);
    expect(selectConditionOffer(offers, {})).toBeNull();
  });

  it('suppresses the match for base-row entries', () => {
    expect(
      selectConditionOffer(offers, {
        selectedCondition: 'used',
        suppressMatch: true,
      })
    ).toBeNull();
    expect(
      selectConditionOffer(offers, {
        selectedCondition: 'used',
        preferredOfferId: 'offer-uk-used',
        suppressMatch: true,
      })
    ).toBeNull();
  });

  it('returns null when offers are missing or empty', () => {
    expect(
      selectConditionOffer(null, { selectedCondition: 'used' })
    ).toBeNull();
    expect(
      selectConditionOffer(undefined, { selectedCondition: 'used' })
    ).toBeNull();
    expect(selectConditionOffer([], { selectedCondition: 'used' })).toBeNull();
  });

  it('honors a preferred id matching the selected condition', () => {
    const cheaper = { id: 'offer-used-cheaper', condition: 'used', price: 480 };
    const candidates = [...offers, cheaper];
    expect(
      selectConditionOffer(candidates, {
        selectedCondition: 'used',
        preferredOfferId: 'offer-used-cheaper',
      })
    ).toEqual(cheaper);
  });

  it('falls through to condition matching for foreign or unknown ids', () => {
    expect(
      selectConditionOffer(offers, {
        selectedCondition: 'used',
        preferredOfferId: 'offer-refurbished',
      })
    ).toEqual(offers[1]);
    expect(
      selectConditionOffer(offers, {
        selectedCondition: 'open_box',
        preferredOfferId: 'offer-unknown',
      })
    ).toEqual(offers[0]);
  });

  it('keeps same-condition selections on the parent family', () => {
    expect(
      selectConditionOffer(offers, {
        selectedCondition: 'used',
        parentCondition: 'uk_used',
      })
    ).toBeNull();
    expect(
      selectConditionOffer(offers, {
        selectedCondition: 'used',
        parentCondition: null,
      })
    ).toEqual(offers[1]);
  });

  it('still honors an explicit pick on the parent condition', () => {
    expect(
      selectConditionOffer(offers, {
        selectedCondition: 'used',
        preferredOfferId: 'offer-uk-used',
        parentCondition: 'used',
      })
    ).toEqual(offers[1]);
  });

  it('tries ordered advertised ids before the condition fallback', () => {
    const cheaper = { id: 'offer-used-cheaper', condition: 'used', price: 480 };
    const candidates = [...offers, cheaper];
    // A mismatched first id falls through to the next, not the find.
    expect(
      selectConditionOffer(candidates, {
        selectedCondition: 'used',
        preferredOfferIds: ['offer-refurbished', 'offer-used-cheaper'],
      })
    ).toEqual(cheaper);
  });
});

describe('resolveOfferPriceBasis', () => {
  it('prices from the finite offer price, else the parent', () => {
    expect(resolveOfferPriceBasis('80', 100)).toBe(80);
    expect(resolveOfferPriceBasis(null, 100)).toBe(100);
    expect(resolveOfferPriceBasis('', 100)).toBe(100);
  });
});

describe('resolveOfferAllocatableStock', () => {
  it('binds the finite scalar on legacy policies', () => {
    expect(resolveOfferAllocatableStock(2, { parentStock: 9 })).toBe(2);
    expect(resolveOfferAllocatableStock(0, { parentStock: 9 })).toBe(0);
  });

  it('inherits the parent stock when the scalar is missing', () => {
    expect(resolveOfferAllocatableStock(null, { parentStock: 9 })).toBe(9);
  });

  it('caps strict scalars by the base units', () => {
    expect(
      resolveOfferAllocatableStock(5, {
        parentStock: 9,
        effective_policy: 'serialized_strict',
        availableUnits: 2,
      })
    ).toBe(2);
    expect(
      resolveOfferAllocatableStock(null, {
        parentStock: 9,
        effective_policy: 'serialized_strict',
        availableUnits: 2,
      })
    ).toBe(2);
  });

  it('keeps unlimited null scalars unbounded', () => {
    expect(
      resolveOfferAllocatableStock(null, {
        parentStock: 9,
        effective_policy: 'serialized_then_unlimited',
      })
    ).toBeNull();
    expect(
      resolveOfferAllocatableStock(4, {
        parentStock: 9,
        effective_policy: 'serialized_then_unlimited',
      })
    ).toBe(4);
  });
});
