import { describe, expect, it } from 'vitest';
import { getTransactionReviewDiscountPricing } from './transaction-review-discount-pricing';
import type { TransactionReviewOrderRow } from './transaction-review-types';

describe('getTransactionReviewDiscountPricing', () => {
  it('keeps admin discounts out of assurance allocation', () => {
    const order: TransactionReviewOrderRow = {
      ad_tracking: {
        baci_transaction_discount: { status: 'admin_edit', version: 4 },
      },
      created_at: '2026-08-30T12:30:00.000Z',
      customer_email: null,
      customer_name: 'Admin Edited Discount Customer',
      customer_phone: null,
      discount_amount: 20,
      fulfillment_details: null,
      id: 'order-admin-edited-discount',
      order_items: [
        {
          assurance_fee: 10,
          fulfillment_data: null,
          id: 'item-admin-edited-discount',
          name: 'Admin Edited Product',
          price: 100,
          product_id: 'product-admin-edited-discount',
          products: null,
          quantity: 1,
        },
      ],
      order_number: 'ORD-ADMIN-EDITED-DISCOUNT',
      payment_method: 'card',
      total: 90,
    };

    const result = getTransactionReviewDiscountPricing(
      order,
      order.order_items ?? []
    );

    expect(result).toEqual({
      discountAmount: 20,
      discountedUnitPrices: [80],
    });
  });
});
