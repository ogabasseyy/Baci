import { describe, expect, it } from 'vitest';
import { mapTransactionOrderRows } from './transaction-review';
import { getDiscountedTransactionUnitPrices } from './transaction-review-discount';

describe('transaction review discount VAT fallback', () => {
  it('preserves VAT relief when a compatibility fallback cannot match v3 line keys', () => {
    const row = {
      ad_tracking: {
        baci_transaction_discount: {
          lineDiscounts: [
            {
              lineId: 1,
              lineKey: '["product-1",null,"new",{}]',
              merchandiseDiscount: 2,
              productId: 'product-1',
              vatRelief: 0.15,
              variantId: null,
            },
          ],
          version: 3,
        },
      },
      created_at: '2026-08-27T12:30:00.000Z',
      customer_email: null,
      customer_name: 'VAT Compatibility Customer',
      customer_phone: null,
      discount_amount: 2.15,
      fulfillment_details: null,
      id: 'order-vat-compatibility',
      order_items: [
        {
          cost_price: 50,
          fulfillment_data: null,
          id: 'item-vat-compatibility',
          line_id: 1,
          name: 'VAT Compatibility Product',
          price: 100,
          product_id: 'product-1',
          products: null,
          quantity: 1,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
      order_number: 'ORD-VAT-COMPATIBILITY',
      payment_method: 'card',
      source: 'physical',
      total: 97.85,
    };

    const [order] = mapTransactionOrderRows([row]);

    expect(order.items[0]).toMatchObject({
      profit: 48,
      revenue: 98,
    });
  });

  it('preserves explicit merchandise totals across mixed VAT lines', () => {
    const prices = getDiscountedTransactionUnitPrices(
      [
        {
          condition: 'new',
          line_id: 1,
          price: 100,
          product_id: 'product-standard',
          quantity: 1,
          vat_category_code: 'S',
          vat_rate: 7.5,
          variant_id: null,
        },
        {
          condition: 'new',
          line_id: 2,
          price: 100,
          product_id: 'product-zero-rated',
          quantity: 1,
          vat_category_code: 'Z',
          vat_rate: 0,
          variant_id: null,
        },
      ],
      21.5,
      {
        lineDiscounts: [
          {
            lineId: 1,
            lineKey: '["product-standard",null,"used",{}]',
            merchandiseDiscount: 20,
            productId: 'product-standard',
            vatRelief: 1.5,
            variantId: null,
          },
        ],
      }
    );

    expect(prices).toEqual([90, 90]);
  });

  it('allocates a legacy gross discount by each line VAT-inclusive basis', () => {
    const prices = getDiscountedTransactionUnitPrices(
      [
        {
          price: 10_000_000,
          quantity: 1,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
        {
          price: 10_000_000,
          quantity: 1,
          vat_category_code: 'Z',
          vat_rate: 0,
        },
      ],
      415_000,
      { discountIncludesVat: true }
    );

    expect(prices).toEqual([9_800_000, 9_800_000]);
  });

  it('allocates voucher residuals from the VAT-inclusive merchandise basis', () => {
    const prices = getDiscountedTransactionUnitPrices(
      [
        {
          price: 100,
          quantity: 1,
          quiz_award_id: 'award-1',
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
        {
          price: 100,
          quantity: 1,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
      102.15,
      { discountIncludesVat: true }
    );

    expect(prices).toEqual([0, 98]);
  });
});
