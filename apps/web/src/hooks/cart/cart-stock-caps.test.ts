import { describe, expect, it } from 'vitest';
import {
  applyOfferAllocationCap,
  capQuantityToStrictPool,
  getSimpleProductCartTotal,
  getStrictSerializedPool,
  resolveCappedOfferAllocation,
} from './cart-stock-caps';
import type { CartItem } from './cart-types';

function line(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'p1',
    quantity: 1,
    ...overrides,
  } as CartItem;
}

describe('getStrictSerializedPool', () => {
  it('returns the floored pool for strict products with finite stock', () => {
    expect(
      getStrictSerializedPool({
        inventory_tracking_policy: 'serialized_strict',
        stock_quantity: 3.7,
      })
    ).toBe(3);
  });

  it('returns undefined for non-strict, unmanaged, and non-finite shapes', () => {
    expect(
      getStrictSerializedPool({
        inventory_tracking_policy: 'standard',
        stock_quantity: 5,
      })
    ).toBeUndefined();
    expect(
      getStrictSerializedPool({
        inventory_tracking_policy: 'serialized_strict',
        stock_quantity: null,
      })
    ).toBeUndefined();
    expect(
      getStrictSerializedPool({
        inventory_tracking_policy: 'serialized_strict',
        stock_quantity: Number.NaN,
      })
    ).toBeUndefined();
    expect(
      getStrictSerializedPool({
        inventory_tracking_policy: 'serialized_strict',
        stock_quantity: -1,
      })
    ).toBeUndefined();
  });
});

describe('getSimpleProductCartTotal', () => {
  it('sums simple lines and skips variants, vouchers, and other products', () => {
    const cart = [
      line({ quantity: 2 }),
      line({ quantity: 1, offerId: 'o1' }),
      line({ quantity: 9, variantId: 'v1' }),
      line({ quantity: 9, quizAwardId: 'a1' }),
      line({ quantity: 9, quizVoucherToken: 't1' }),
      line({ id: 'p2', quantity: 9 }),
    ];

    expect(getSimpleProductCartTotal(cart, 'p1')).toBe(3);
  });

  it('excludes the line at excludeIndex', () => {
    const cart = [line({ quantity: 2 }), line({ quantity: 1 })];

    expect(getSimpleProductCartTotal(cart, 'p1', 0)).toBe(1);
  });
});

describe('resolveCappedOfferAllocation', () => {
  it('caps offer adds at the floored stock allocation', () => {
    expect(
      resolveCappedOfferAllocation({
        isVoucherLine: false,
        offerId: 'o1',
        stock: 2.9,
      })
    ).toBe(2);
  });

  it('skips the cap for voucher, offerless, and non-finite lines', () => {
    expect(
      resolveCappedOfferAllocation({
        isVoucherLine: true,
        offerId: 'o1',
        stock: 2,
      })
    ).toBeUndefined();
    expect(
      resolveCappedOfferAllocation({
        isVoucherLine: false,
        offerId: null,
        stock: 2,
      })
    ).toBeUndefined();
    expect(
      resolveCappedOfferAllocation({
        isVoucherLine: false,
        offerId: 'o1',
        stock: Number.POSITIVE_INFINITY,
      })
    ).toBeUndefined();
    expect(
      resolveCappedOfferAllocation({
        isVoucherLine: false,
        offerId: 'o1',
        stock: -1,
      })
    ).toBeUndefined();
  });
});

describe('applyOfferAllocationCap', () => {
  it('caps updates at the allocation and keeps the line on zero', () => {
    expect(
      applyOfferAllocationCap({ offerId: 'o1', stock: 2, quantity: 5 })
    ).toEqual({ quantity: 2 });
    expect(
      applyOfferAllocationCap({ offerId: 'o1', stock: 0, quantity: 5 })
    ).toEqual({ keepPrevious: true });
  });

  it('returns null when no cap applies', () => {
    expect(
      applyOfferAllocationCap({ offerId: null, stock: 2, quantity: 5 })
    ).toBeNull();
    expect(
      applyOfferAllocationCap({
        offerId: 'o1',
        stock: Number.NaN,
        quantity: 5,
      })
    ).toBeNull();
  });
});

describe('capQuantityToStrictPool', () => {
  it('leaves the quantity untouched without a pool', () => {
    expect(
      capQuantityToStrictPool({
        strictPool: undefined,
        cart: [line({ quantity: 9 })],
        productId: 'p1',
        quantity: 4,
      })
    ).toBe(4);
  });

  it('caps at the remaining headroom outside the excluded sibling', () => {
    const cart = [line({ quantity: 2 }), line({ quantity: 1 })];

    expect(
      capQuantityToStrictPool({
        strictPool: 3,
        cart,
        productId: 'p1',
        excludeIndex: 1,
        quantity: 5,
      })
    ).toBe(1);
    expect(
      capQuantityToStrictPool({
        strictPool: 3,
        cart,
        productId: 'p1',
        quantity: 5,
      })
    ).toBe(0);
  });
});
