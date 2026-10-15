import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import { applyStorefrontCartLineAdd } from './cart-line-add';
import type { AddToCartOptions, CartItem } from './cart-types';

const product = {
  id: 'prod-1',
  merchant_id: 'merch-1',
  name: 'Test Product',
  price: 100,
  manage_stock: true,
  stock: 10,
} as Product;

const assurance = {
  smartCartProEnabled: true,
  merchantSlug: 'ogabassey',
  hasQuizVoucher: false,
  shippingInsuranceEnabled: true,
};

const openCaps = { cappedOfferAllocation: undefined, strictPool: undefined };

describe('applyStorefrontCartLineAdd', () => {
  it('appends a fresh line with the default-on assurance choice', () => {
    const result = applyStorefrontCartLineAdd({
      previousCart: [],
      product,
      productForCart: product,
      normalizedOptions: undefined,
      quantity: 2,
      caps: openCaps,
      assurance,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'prod-1',
      quantity: 2,
      hasAssurance: true,
      negotiationStatus: 'none',
    });
    expect(result[0].cartItemId).toBeTruthy();
  });

  it('merges into the matching line and preserves its stored choices', () => {
    const options = { offerId: 'offer-1' } as AddToCartOptions;
    const fresh = applyStorefrontCartLineAdd({
      previousCart: [],
      product,
      productForCart: product,
      normalizedOptions: options,
      quantity: 1,
      caps: openCaps,
      assurance,
    });
    // The shopper opted out after the first add.
    const optedOut = [{ ...fresh[0], hasAssurance: false }];

    const result = applyStorefrontCartLineAdd({
      previousCart: optedOut,
      product,
      productForCart: product,
      normalizedOptions: options,
      quantity: 2,
      caps: openCaps,
      assurance,
    });

    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(3);
    expect(result[0].cartItemId).toBe(fresh[0].cartItemId);
    // Silent merges never flip an explicit opt-out.
    expect(result[0].hasAssurance).toBe(false);
  });

  it('returns the same cart reference when caps keep the previous cart', () => {
    const previousCart: CartItem[] = [];

    const result = applyStorefrontCartLineAdd({
      previousCart,
      product,
      productForCart: product,
      normalizedOptions: { offerId: 'offer-1' } as AddToCartOptions,
      quantity: 1,
      caps: { cappedOfferAllocation: 0, strictPool: undefined },
      assurance,
    });

    expect(result).toBe(previousCart);
  });

  it('refreshes cap metadata on merge so later edits use live values', () => {
    const fresh = applyStorefrontCartLineAdd({
      previousCart: [],
      product,
      productForCart: product,
      normalizedOptions: undefined,
      quantity: 1,
      caps: openCaps,
      assurance,
    });
    // Allocation rose after the first add; the retained line is stale.
    const stale = [{ ...fresh[0], stock: 1, stock_quantity: 1 }];
    const liveProduct = {
      ...product,
      stock: 5,
      stock_quantity: 5,
      inventory_tracking_policy: 'serialized_strict',
    } as Product;

    const result = applyStorefrontCartLineAdd({
      previousCart: stale,
      product,
      productForCart: liveProduct,
      normalizedOptions: undefined,
      quantity: 1,
      caps: openCaps,
      assurance,
    });

    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(2);
    expect(result[0].stock).toBe(5);
    expect(result[0].stock_quantity).toBe(5);
  });

  it('preserves pool metadata when the incoming projection omits it', () => {
    const strictProduct = {
      ...product,
      stock: 5,
      stock_quantity: 5,
      inventory_tracking_policy: 'serialized_strict',
    } as Product;
    const fresh = applyStorefrontCartLineAdd({
      previousCart: [],
      product: strictProduct,
      productForCart: strictProduct,
      normalizedOptions: undefined,
      quantity: 1,
      caps: openCaps,
      assurance,
    });
    // A chat/agent partial projection carries no pool fields.
    const partial = {
      ...product,
      stock: 5,
      stock_quantity: undefined,
      inventory_tracking_policy: undefined,
    } as unknown as Product;

    const result = applyStorefrontCartLineAdd({
      previousCart: fresh,
      product: partial,
      productForCart: partial,
      normalizedOptions: undefined,
      quantity: 1,
      caps: openCaps,
      assurance,
    });

    expect(result).toHaveLength(1);
    expect(result[0].stock_quantity).toBe(5);
    expect(result[0].inventory_tracking_policy).toBe('serialized_strict');
  });

  it('leaves fresh lines unassured when insurance is disabled', () => {
    const result = applyStorefrontCartLineAdd({
      previousCart: [],
      product,
      productForCart: product,
      normalizedOptions: undefined,
      quantity: 1,
      caps: openCaps,
      assurance: { ...assurance, shippingInsuranceEnabled: false },
    });

    expect(result[0].hasAssurance).toBe(false);
  });

  it('leaves fresh lines unassured when the insurance setting is unknown', () => {
    const result = applyStorefrontCartLineAdd({
      previousCart: [],
      product,
      productForCart: product,
      normalizedOptions: undefined,
      quantity: 1,
      caps: openCaps,
      assurance: { ...assurance, shippingInsuranceEnabled: undefined },
    });

    expect(result[0].hasAssurance).toBe(false);
  });
});
