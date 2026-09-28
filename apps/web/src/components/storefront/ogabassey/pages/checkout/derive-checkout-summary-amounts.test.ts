import { describe, expect, it } from 'vitest';
import { deriveCheckoutSummaryAmounts } from './derive-checkout-summary-amounts';
import type { ResumedOrder } from './types';

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

describe('deriveCheckoutSummaryAmounts', () => {
  it('projects persisted adjustments and uses a rate-neutral resumed tax label', () => {
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

  it('preserves active-cart values and the existing fresh VAT label', () => {
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
