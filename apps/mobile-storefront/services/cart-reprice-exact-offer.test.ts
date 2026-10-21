import type { CartItem } from '@/stores/cart-store';
import {
  reconcileOfferLineAllocations,
  reconcileStrictBasePools,
  repriceExactOfferLine,
} from './cart-reprice-exact-offer';
import type { LiveOfferRepriceMap } from './cart-reprice-offer-lines';
import { EMPTY_REPRICE_RESULT, type RepriceResult } from './cart-reprice-types';

function line(overrides: Partial<CartItem> & { id: string }): CartItem {
  return {
    product_id: 'p1',
    slug: `slug-${overrides.id}`,
    name: `Item ${overrides.id}`,
    price: 1000,
    quantity: 1,
    ...overrides,
  };
}

function freshResult(): RepriceResult {
  return {
    priceById: {},
    conditionById: {},
    changes: [],
    conditionChanges: [],
    unavailable: [],
    offerIdById: {},
    adoptions: [],
  };
}

describe('repriceExactOfferLine', () => {
  it('marks the line unavailable when the offer row vanished', () => {
    const item = line({ id: 'a', offer_id: 'offer-1' });
    const result = freshResult();
    repriceExactOfferLine({
      effectiveItem: { ...item, offer_id: 'offer-1' },
      item,
      offerEligibleParents: new Set(['p1']),
      offerLineAllocations: [],
      offerPrice: new Map() as LiveOfferRepriceMap,
      result,
    });
    expect(result.unavailable).toEqual([{ id: 'a', name: 'Item a' }]);
  });

  it('marks the line unavailable when the parent is offer-ineligible', () => {
    const item = line({ id: 'a', offer_id: 'offer-1' });
    const result = freshResult();
    repriceExactOfferLine({
      effectiveItem: { ...item, offer_id: 'offer-1' },
      item,
      offerEligibleParents: new Set(['other-product']),
      offerLineAllocations: [],
      offerPrice: new Map([
        ['offer-1', { productId: 'p1', price: 900, condition: null }],
      ]) as LiveOfferRepriceMap,
      result,
    });
    expect(result.unavailable).toEqual([{ id: 'a', name: 'Item a' }]);
  });

  it('records the live price and allocation for a resolved offer', () => {
    const item = line({ id: 'a', offer_id: 'offer-1', quantity: 2 });
    const result = freshResult();
    const offerLineAllocations: {
      id: string;
      name: string;
      offerId: string;
      quantity: number;
    }[] = [];
    repriceExactOfferLine({
      effectiveItem: { ...item, offer_id: 'offer-1' },
      item,
      offerEligibleParents: new Set(['p1']),
      offerLineAllocations,
      offerPrice: new Map([
        ['offer-1', { productId: 'p1', price: 900, condition: null }],
      ]) as LiveOfferRepriceMap,
      result,
    });
    expect(result.unavailable).toEqual([]);
    expect(result.priceById).toEqual({ a: 900 });
    expect(offerLineAllocations).toEqual([
      { id: 'a', name: 'Item a', offerId: 'offer-1', quantity: 2 },
    ]);
  });
});

describe('reconcileStrictBasePools', () => {
  const strictPool = {
    p1: { effective_policy: 'serialized_strict', available_units: 3 },
  };

  it('skips the check when the inventory projection is missing', () => {
    const result = freshResult();
    reconcileStrictBasePools({
      baseInventoryByProductId: null,
      items: [line({ id: 'a', quantity: 9 })],
      result,
    });
    expect(result.unavailable).toEqual([]);
  });

  it('flags every sibling when the aggregate exceeds the pool', () => {
    const result = freshResult();
    reconcileStrictBasePools({
      baseInventoryByProductId: strictPool,
      items: [line({ id: 'a', quantity: 2 }), line({ id: 'b', quantity: 2 })],
      result,
    });
    expect(result.unavailable).toEqual([
      { id: 'a', name: 'Item a' },
      { id: 'b', name: 'Item b' },
    ]);
  });

  it('leaves lines alone when the aggregate fits the pool', () => {
    const result = freshResult();
    reconcileStrictBasePools({
      baseInventoryByProductId: strictPool,
      items: [line({ id: 'a', quantity: 2 }), line({ id: 'b', quantity: 1 })],
      result,
    });
    expect(result.unavailable).toEqual([]);
  });

  it('excludes already-unavailable lines from the pool total', () => {
    // A strict product with one valid base line (2 units) and one
    // vanished offer line (2 units) against a 3-unit pool: without
    // the exclusion the aggregate is 4 and the valid line is
    // wrongly flagged too; with it the aggregate is 2 and the valid
    // line stays available.
    const result = {
      ...EMPTY_REPRICE_RESULT,
      unavailable: [{ id: 'bad', name: 'Item bad' }],
      priceById: {},
      conditionById: {},
      changes: [],
      conditionChanges: [],
      offerIdById: {},
      adoptions: [],
    };
    reconcileStrictBasePools({
      baseInventoryByProductId: strictPool,
      items: [line({ id: 'a', quantity: 2 }), line({ id: 'bad', quantity: 2 })],
      result,
    });
    expect(result.unavailable).toEqual([{ id: 'bad', name: 'Item bad' }]);
  });
});

describe('reconcileOfferLineAllocations', () => {
  it('flags every contributing line when the aggregate exceeds live stock', () => {
    const result = freshResult();
    reconcileOfferLineAllocations({
      offerLineAllocations: [
        { id: 'a', name: 'Item a', offerId: 'offer-1', quantity: 2 },
        { id: 'b', name: 'Item b', offerId: 'offer-1', quantity: 2 },
      ],
      offerPrice: new Map([
        ['offer-1', { stockQuantity: 3 }],
      ]) as LiveOfferRepriceMap,
      result,
    });
    expect(result.unavailable).toEqual([
      { id: 'a', name: 'Item a' },
      { id: 'b', name: 'Item b' },
    ]);
  });

  it('leaves lines alone when the aggregate fits live stock', () => {
    const result = freshResult();
    reconcileOfferLineAllocations({
      offerLineAllocations: [
        { id: 'a', name: 'Item a', offerId: 'offer-1', quantity: 2 },
      ],
      offerPrice: new Map([
        ['offer-1', { stockQuantity: 3 }],
      ]) as LiveOfferRepriceMap,
      result,
    });
    expect(result.unavailable).toEqual([]);
  });

  it('skips offers with unknown live stock', () => {
    const result = freshResult();
    reconcileOfferLineAllocations({
      offerLineAllocations: [
        { id: 'a', name: 'Item a', offerId: 'offer-1', quantity: 9 },
      ],
      offerPrice: new Map([
        ['offer-1', { stockQuantity: null }],
      ]) as LiveOfferRepriceMap,
      result,
    });
    expect(result.unavailable).toEqual([]);
  });
});
