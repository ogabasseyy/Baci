import { describe, expect, it } from 'vitest';
import type { Product as CartProduct } from '@/lib/products';
import {
  applyCriticalRouteOfferToCartProduct,
  buildCriticalCartAddOptions,
  resolveCriticalActiveOffer,
} from './critical-commerce-route-offer';

const offers = [
  { id: 'offer-new', condition: 'new' as const, price: 100, stock_quantity: 10 },
  { id: 'offer-used', condition: 'used' as const, price: 60, stock_quantity: 3 },
];

describe('resolveCriticalActiveOffer', () => {
  it('resolves the pinned offer when the condition matches', () => {
    expect(
      resolveCriticalActiveOffer({
        offers,
        initialOfferId: 'offer-used',
        dismissed: false,
        hasPurchasableVariantSelection: false,
        selectedCondition: 'used',
      })
    ).toEqual(offers[1]);
  });

  it('keeps the pin when no condition is selected yet', () => {
    expect(
      resolveCriticalActiveOffer({
        offers,
        initialOfferId: 'offer-used',
        dismissed: false,
        hasPurchasableVariantSelection: false,
        selectedCondition: null,
      })
    ).toEqual(offers[1]);
  });

  it('drops the pin for a mismatched condition, a variant, a dismissal, or an unknown id', () => {
    const base = {
      offers,
      initialOfferId: 'offer-used',
      dismissed: false,
      hasPurchasableVariantSelection: false,
      selectedCondition: 'used' as string | null,
    };
    expect(
      resolveCriticalActiveOffer({ ...base, selectedCondition: 'new' })
    ).toBeNull();
    expect(
      resolveCriticalActiveOffer({
        ...base,
        hasPurchasableVariantSelection: true,
      })
    ).toBeNull();
    expect(
      resolveCriticalActiveOffer({ ...base, dismissed: true })
    ).toBeNull();
    expect(
      resolveCriticalActiveOffer({ ...base, initialOfferId: 'offer-gone' })
    ).toBeNull();
    expect(
      resolveCriticalActiveOffer({ ...base, initialOfferId: null })
    ).toBeNull();
  });
});

describe('applyCriticalRouteOfferToCartProduct', () => {
  it('prices from the offer and enforces its allocation', () => {
    const base = {
      condition: 'new',
      manage_stock: false,
      price: 100,
      stock: 10,
    } as CartProduct;
    const applied = applyCriticalRouteOfferToCartProduct(
      base,
      offers[1]!,
      base
    );

    expect(applied.price).toBe(60);
    expect(applied.condition).toBe('used');
    expect(applied.manage_stock).toBe(true);
    expect(applied.stock).toBe(3);
  });

  it('caps the offer allocation by the strict base pool', () => {
    const base = {
      inventory_tracking_policy: 'serialized_strict',
      price: 100,
      stock: 2,
      stock_quantity: 2,
    } as CartProduct;
    const applied = applyCriticalRouteOfferToCartProduct(
      base,
      { id: 'offer-big', condition: 'used', price: 60, stock_quantity: 5 },
      base
    );

    expect(applied.stock).toBe(2);
  });

  it('prefers the anchor-derived effective policy over an off row policy', () => {
    const base = {
      effective_policy: 'serialized_strict',
      inventory_tracking_policy: 'off',
      price: 100,
      stock: 2,
      stock_quantity: 2,
    } as CartProduct;
    const applied = applyCriticalRouteOfferToCartProduct(
      base,
      { id: 'offer-big', condition: 'used', price: 60, stock_quantity: 5 },
      base
    );

    expect(applied.stock).toBe(2);
  });

  it('keeps the scalar under then-unlimited and unpolicied bases', () => {
    const unlimited = {
      inventory_tracking_policy: 'serialized_then_unlimited',
      stock: 1,
      stock_quantity: 1,
    } as CartProduct;
    expect(
      applyCriticalRouteOfferToCartProduct(
        unlimited,
        { id: 'offer-big', condition: 'used', price: 60, stock_quantity: 5 },
        unlimited
      ).stock
    ).toBe(5);

    const plain = { stock: 1, stock_quantity: 1 } as CartProduct;
    expect(
      applyCriticalRouteOfferToCartProduct(
        plain,
        { id: 'offer-big', condition: 'used', price: 60, stock_quantity: 5 },
        plain
      ).stock
    ).toBe(5);
  });
});

describe('buildCriticalCartAddOptions', () => {
  it('forwards the exact offer id without a variant selection', () => {
    expect(
      buildCriticalCartAddOptions({
        purchasableSelection: null,
        productForCart: { condition: 'used' } as CartProduct,
        activeRouteOffer: offers[1]!,
      })
    ).toEqual({ condition: 'used', offerId: 'offer-used' });
  });

  it('omits the offer id when no offer is pinned', () => {
    expect(
      buildCriticalCartAddOptions({
        purchasableSelection: null,
        productForCart: { condition: 'new' } as CartProduct,
        activeRouteOffer: null,
      })
    ).toEqual({ condition: 'new' });
  });

  it('returns undefined without condition or offer', () => {
    expect(
      buildCriticalCartAddOptions({
        purchasableSelection: null,
        productForCart: {} as CartProduct,
        activeRouteOffer: null,
      })
    ).toBeUndefined();
  });
});
