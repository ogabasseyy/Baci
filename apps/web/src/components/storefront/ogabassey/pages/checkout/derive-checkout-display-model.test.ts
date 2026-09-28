import { describe, expect, it } from 'vitest';
import type { CartItem } from '@/hooks/cart';
import { deriveCheckoutDisplayModel } from './derive-checkout-display-model';
import type { ResumedOrder } from './types';

function cartItem(id: string, price: number): CartItem {
  return {
    brand: 'Baci',
    cartItemId: `cart-${id}`,
    description: 'Test item',
    gtin: '',
    id,
    image: '/item.png',
    imageHint: 'Test item',
    imageLarge: '/item.png',
    manage_stock: false,
    mpn: '',
    name: 'Test item',
    price,
    quantity: 2,
    status: 'active',
    stock: 10,
  };
}

function resumedOrder(overrides: Partial<ResumedOrder> = {}): ResumedOrder {
  return {
    id: 'order-1',
    short_id: 'BACI-1',
    subtotal: 1_000,
    shipping_cost: 200,
    total: 1_300,
    customer_name: 'Ada Lovelace',
    customer_email: 'ada@example.com',
    customer_phone: '08000000000',
    shipping_address: {
      address: '12 Broad Street',
      city: 'Lagos Island',
      state: 'Lagos',
      phone: '08000000000',
    },
    items: [
      {
        id: 'line-1',
        product_id: 'product-1',
        product_name: 'Resumed item',
        quantity: 2,
        price: 500,
        image_url: '/resumed.png',
      },
    ],
    ...overrides,
  };
}

describe('deriveCheckoutDisplayModel', () => {
  it('uses active cart rows and totals when the cart is populated', () => {
    const item = cartItem('product-1', 750);
    const checkoutCart = [item];
    const model = deriveCheckoutDisplayModel({
      checkoutCart,
      checkoutCartTotal: 1_500,
      currencyCode: 'NGN',
      itemSubtotal: 1_400,
      resumedOrder: resumedOrder(),
    });

    expect(model).toMatchObject({
      effectiveCheckoutCartTotal: 1_500,
      effectiveItemSubtotal: 1_400,
      summarySubtotal: 1_500,
      hasCheckoutCartItems: true,
    });
    expect(model.displayItems).toEqual([{ kind: 'cart', ...item }]);
    expect(model.mobileSummaryCart).toBe(checkoutCart);
  });

  it('projects resumed order rows and preserves its canonical total', () => {
    const order = resumedOrder({
      total: 1_450,
      subtotal: 1_100,
      shipping_cost: 300,
      tax_amount: 100,
      discount_amount: 75,
      gift_wrapping_fee: 25,
    });
    const model = deriveCheckoutDisplayModel({
      checkoutCart: [],
      checkoutCartTotal: 2_000,
      currencyCode: 'USD',
      itemSubtotal: 0,
      resumedOrder: order,
    });

    expect(model).toMatchObject({
      effectiveCheckoutCartTotal: 1_450,
      effectiveItemSubtotal: 1_100,
      summarySubtotal: 1_100,
      hasCheckoutCartItems: false,
    });
    expect(model.displayItems).toEqual([
      { kind: 'resumed', ...order.items[0] },
    ]);
    expect(model.mobileSummaryCart).toEqual([
      {
        brand: '',
        cartItemId: 'line-1',
        description: '',
        gtin: '',
        id: 'product-1',
        image: '/resumed.png',
        imageHint: 'Resumed item',
        imageLarge: '/resumed.png',
        manage_stock: false,
        mpn: '',
        name: 'Resumed item',
        price: 500,
        quantity: 2,
        status: 'active',
        stock: 2,
      },
    ]);
  });

  it('returns an empty summary with the current checkout total when no order is resumed', () => {
    const model = deriveCheckoutDisplayModel({
      checkoutCart: [],
      checkoutCartTotal: 875,
      currencyCode: 'NGN',
      itemSubtotal: 875,
      resumedOrder: null,
    });

    expect(model).toEqual({
      displayItems: [],
      effectiveCheckoutCartTotal: 875,
      effectiveItemSubtotal: 0,
      summarySubtotal: 875,
      hasCheckoutCartItems: false,
      mobileSummaryCart: [],
    });
  });
});
