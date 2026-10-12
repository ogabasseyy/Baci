import { describe, expect, it } from 'vitest';
import {
  applyOfferAllocationCap,
  capAddedSimpleLineQuantity,
  capQuantityToStrictPool,
  capUpdatedSimpleLineQuantity,
  getSimpleProductCartTotal,
  getStrictSerializedPool,
  resolveCappedOfferAllocation,
  resolveSimpleLineAddCaps,
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

describe('resolveSimpleLineAddCaps', () => {
  const strictProduct = {
    inventory_tracking_policy: 'serialized_strict',
    stock_quantity: 4,
  } as CartItem;

  it('returns the offer allocation and strict pool for simple offer adds', () => {
    expect(
      resolveSimpleLineAddCaps({
        product: strictProduct,
        isVoucherLine: false,
        variantId: null,
        offerId: 'offer-1',
        stock: 6,
      })
    ).toEqual({ cappedOfferAllocation: 6, strictPool: 4 });
  });

  it('skips the pool for variant and voucher adds', () => {
    expect(
      resolveSimpleLineAddCaps({
        product: strictProduct,
        isVoucherLine: false,
        variantId: 'variant-1',
        offerId: null,
        stock: 6,
      }).strictPool
    ).toBeUndefined();
    expect(
      resolveSimpleLineAddCaps({
        product: strictProduct,
        isVoucherLine: true,
        variantId: null,
        offerId: 'offer-1',
        stock: 6,
      })
    ).toEqual({ cappedOfferAllocation: undefined, strictPool: undefined });
  });
});

describe('capAddedSimpleLineQuantity', () => {
  const cart = [line({ quantity: 3 })];

  it('caps through the offer allocation then pool headroom', () => {
    expect(
      capAddedSimpleLineQuantity({
        caps: { cappedOfferAllocation: 5, strictPool: 4 },
        cart,
        productId: 'p1',
        excludeIndex: 0,
        quantity: 8,
      })
    ).toEqual({ quantity: 4 });
  });

  it('keeps the previous cart when either gate goes to zero', () => {
    expect(
      capAddedSimpleLineQuantity({
        caps: { cappedOfferAllocation: 0, strictPool: undefined },
        cart,
        productId: 'p1',
        quantity: 2,
      })
    ).toEqual({ keepPrevious: true });
    expect(
      capAddedSimpleLineQuantity({
        caps: { cappedOfferAllocation: undefined, strictPool: 3 },
        cart,
        productId: 'p1',
        quantity: 2,
      })
    ).toEqual({ keepPrevious: true });
  });

  it('passes uncapped quantities through untouched', () => {
    expect(
      capAddedSimpleLineQuantity({
        caps: { cappedOfferAllocation: undefined, strictPool: undefined },
        cart,
        productId: 'p1',
        quantity: 2,
      })
    ).toEqual({ quantity: 2 });
  });
});

describe('capUpdatedSimpleLineQuantity', () => {
  const cart = [line({ quantity: 1 }), line({ quantity: 2 })];

  it('applies the allocation cap then pool headroom outside the line', () => {
    const item = line({
      quantity: 1,
      offerId: 'offer-1',
      stock: 5,
      inventory_tracking_policy: 'serialized_strict',
      stock_quantity: 4,
    });
    expect(
      capUpdatedSimpleLineQuantity({ item, cart, excludeIndex: 0, quantity: 9 })
    ).toEqual({ quantity: 2 });
  });

  it('keeps the previous quantity on zero allocation or headroom', () => {
    const deadOffer = line({ offerId: 'offer-1', stock: 0 });
    expect(
      capUpdatedSimpleLineQuantity({
        item: deadOffer,
        cart,
        excludeIndex: 0,
        quantity: 4,
      })
    ).toEqual({ keepPrevious: true });
    const noHeadroom = line({
      inventory_tracking_policy: 'serialized_strict',
      stock_quantity: 2,
    });
    expect(
      capUpdatedSimpleLineQuantity({
        item: noHeadroom,
        cart,
        excludeIndex: 0,
        quantity: 4,
      })
    ).toEqual({ keepPrevious: true });
  });

  it('skips the pool aggregate for variant and voucher lines', () => {
    const variant = line({
      variantId: 'variant-1',
      inventory_tracking_policy: 'serialized_strict',
      stock_quantity: 1,
    });
    expect(
      capUpdatedSimpleLineQuantity({
        item: variant,
        cart,
        excludeIndex: 0,
        quantity: 4,
      })
    ).toEqual({ quantity: 4 });
  });
});
