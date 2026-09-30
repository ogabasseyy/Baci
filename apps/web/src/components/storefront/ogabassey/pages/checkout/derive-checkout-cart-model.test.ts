import { describe, expect, it } from 'vitest';
import type { CartItem } from '@/hooks/cart';
import { deriveCheckoutCartModel } from './derive-checkout-cart-model';

const negotiatedCart: CartItem[] = [
  {
    id: 'phone',
    cartItemId: 'phone::base',
    name: 'Phone',
    price: 1000,
    quantity: 2,
    negotiatedPrice: 800,
    negotiationStatus: 'accepted',
    cartDiscount: 400,
    hasAssurance: true,
    assuranceRate: 0.05,
  } as CartItem,
];

describe('deriveCheckoutCartModel', () => {
  it('strips negotiated pricing when the merchant is not entitled', () => {
    const model = deriveCheckoutCartModel(negotiatedCart, false);

    expect(model.checkoutCart[0]).toMatchObject({
      price: 1000,
      quantity: 2,
      negotiatedPrice: undefined,
      negotiationStatus: undefined,
      cartDiscount: undefined,
    });
    expect(model.checkoutCartTotal).toBe(2100);
    expect(model.itemSubtotal).toBe(2000);
    expect(model.checkoutCartCatalogSubtotal).toBe(2100);
    expect(model.quoteItemsFingerprint).toBe('phone:2:1000');
  });

  it('uses negotiated line totals while retaining catalog quote totals', () => {
    const model = deriveCheckoutCartModel(negotiatedCart, true);

    expect(model.checkoutCart[0]?.negotiatedPrice).toBe(800);
    expect(model.checkoutCartTotal).toBe(1680);
    expect(model.itemSubtotal).toBe(1600);
    expect(model.checkoutCartCatalogSubtotal).toBe(2080);
    expect(model.quoteItemsFingerprint).toBe('phone:2:800');
  });

  it('changes the quote fingerprint when quantity or effective price changes', () => {
    const initial = deriveCheckoutCartModel(negotiatedCart, true);
    const changedQuantity = deriveCheckoutCartModel(
      [{ ...negotiatedCart[0], quantity: 3 }],
      true
    );
    const changedPrice = deriveCheckoutCartModel(
      [{ ...negotiatedCart[0], negotiatedPrice: 750 }],
      true
    );

    expect(initial.quoteItemsFingerprint).toBe('phone:2:800');
    expect(changedQuantity.quoteItemsFingerprint).toBe('phone:3:800');
    expect(changedPrice.quoteItemsFingerprint).toBe('phone:2:750');
  });
});
