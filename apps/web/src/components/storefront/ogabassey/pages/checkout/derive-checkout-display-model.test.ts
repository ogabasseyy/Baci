import { describe, expect, it } from 'vitest';
import type { CartItem } from '@/hooks/cart';
import {
  deriveCheckoutDisplayModel,
  deriveCheckoutSummaryAmounts,
} from './derive-checkout-display-model';
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
      summaryOrder: order,
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
      summaryOrder: null,
      mobileSummaryCart: [],
    });
  });

  it('projects persisted resumed adjustments and uses a rate-neutral tax label', () => {
    const order = resumedOrder({
      total: 1_450,
      subtotal: 1_100,
      shipping_cost: 300,
      tax_amount: 100,
      discount_amount: 75,
      gift_wrapping_fee: 25,
    });
    expect(
      deriveCheckoutSummaryAmounts({
        deliveryCost: 0,
        deliveryMethod: 'door',
        discountAmount: 0,
        giftWrappingCost: 0,
        hasCheckoutCartItems: false,
        orderTotals: { total: 2_000, taxAmount: 150 },
        resumedOrder: order,
      })
    ).toEqual({
      summaryOrder: order,
      summaryTaxAmount: 100,
      summaryDeliveryCost: 300,
      summaryGiftWrappingCost: 25,
      summaryDiscountAmount: 75,
      summaryDeliveryMethod: null,
      summaryOrderTotals: { total: 1_450, taxAmount: 100 },
      summaryTaxLabel: 'Tax',
    });
  });

  it('keeps active-cart summary values ahead of any resumed order', () => {
    expect(
      deriveCheckoutSummaryAmounts({
        deliveryCost: 40,
        deliveryMethod: 'pickup',
        discountAmount: 10,
        giftWrappingCost: 5,
        hasCheckoutCartItems: true,
        orderTotals: { total: 160, taxAmount: 15 },
        resumedOrder: resumedOrder({
          tax_amount: 20,
          shipping_cost: 30,
          discount_amount: 25,
          gift_wrapping_fee: 8,
        }),
      })
    ).toEqual({
      summaryOrder: null,
      summaryTaxAmount: 15,
      summaryDeliveryCost: 40,
      summaryGiftWrappingCost: 5,
      summaryDiscountAmount: 10,
      summaryDeliveryMethod: 'pickup',
      summaryOrderTotals: { total: 160, taxAmount: 15 },
      summaryTaxLabel: 'VAT (7.5%)',
    });
  });
});
