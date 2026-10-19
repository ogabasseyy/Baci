import { describe, expect, it } from 'vitest';
import { getDiscountedTransactionUnitPrices } from './transaction-review-discount';
import {
  getLegacyNegotiationDiscountOptions,
  isLegacyVatInclusiveNegotiationDiscount,
} from './transaction-review-legacy-discount';
import type { TransactionReviewOrderRow } from './transaction-review-types';

const baseOrder: TransactionReviewOrderRow = {
  created_at: '2026-07-01T12:30:00.000Z',
  customer_email: null,
  customer_name: 'Legacy Customer',
  customer_phone: null,
  discount_amount: 2.15,
  discount_code_id: null,
  fulfillment_details: null,
  id: 'order-legacy',
  order_items: [
    {
      fulfillment_data: null,
      id: 'item-legacy',
      name: 'Legacy Product',
      price: 100,
      product_id: 'product-legacy',
      products: null,
      quantity: 1,
      vat_category_code: 'S',
      vat_rate: 7.5,
    },
  ],
  order_number: 'ORD-LEGACY',
  payment_method: 'card',
  source: 'online_store',
  tax_amount: 7.5,
  total: 100,
};

describe('legacy transaction discount detection', () => {
  it('recognizes a pre-metadata online negotiation with VAT relief', () => {
    expect(
      isLegacyVatInclusiveNegotiationDiscount(
        baseOrder,
        baseOrder.order_items ?? []
      )
    ).toBe(true);
  });

  it('does not classify a physical-order discount as an automatic negotiation', () => {
    expect(
      isLegacyVatInclusiveNegotiationDiscount(
        { ...baseOrder, source: 'physical' },
        baseOrder.order_items ?? []
      )
    ).toBe(false);
  });

  it('keeps the full merchandise discount for a legacy non-VAT order', () => {
    expect(
      isLegacyVatInclusiveNegotiationDiscount(
        { ...baseOrder, tax_amount: 0 },
        baseOrder.order_items ?? []
      )
    ).toBe(false);
  });

  it('recognizes a no-marker negotiation after the former date cutoff', () => {
    expect(
      isLegacyVatInclusiveNegotiationDiscount(
        { ...baseOrder, created_at: '2026-08-28T23:00:00.000Z' },
        baseOrder.order_items ?? []
      )
    ).toBe(true);
  });

  it('does not classify an admin-edited order marker as a negotiation', () => {
    expect(
      isLegacyVatInclusiveNegotiationDiscount(
        {
          ...baseOrder,
          ad_tracking: {
            baci_transaction_discount: {
              status: 'admin_edit',
              version: 4,
            },
          },
        },
        baseOrder.order_items ?? []
      )
    ).toBe(false);
  });

  it('does not classify a historically backfilled admin edit as a negotiation', () => {
    const result = isLegacyVatInclusiveNegotiationDiscount(
      {
        ...baseOrder,
        ad_tracking: {
          baci_transaction_discount: {
            source: 'historical_audit',
            status: 'admin_edit',
            version: 4,
          },
        },
      },
      baseOrder.order_items ?? []
    );

    expect(result).toBe(false);
  });

  it('uses a merchandise-only fallback when mixed VAT categories make relief ambiguous', () => {
    const baseItem = baseOrder.order_items?.[0];
    if (!baseItem) {
      throw new Error('base order fixture is missing an item');
    }

    const order: TransactionReviewOrderRow = {
      ...baseOrder,
      discount_amount: 2,
      order_items: [
        {
          ...baseItem,
          id: 'item-zero-rated',
          name: 'Zero-rated Product',
          vat_category_code: 'Z',
          vat_rate: 0,
        },
        {
          ...baseItem,
          id: 'item-standard-rated',
          name: 'Standard-rated Product',
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
    };

    const options = getLegacyNegotiationDiscountOptions(
      order,
      order.order_items ?? []
    );

    expect(options).toEqual({ discountIncludesVat: false });
    expect(
      getDiscountedTransactionUnitPrices(
        order.order_items ?? [],
        order.discount_amount ?? 0,
        options
      )
    ).toEqual([99, 99]);
  });

  it('does not infer VAT relief when the compatibility fallback omits VAT categories', () => {
    const options = getLegacyNegotiationDiscountOptions(
      { ...baseOrder, discount_amount: 2 },
      (baseOrder.order_items ?? []).map(
        ({ vat_category_code, vat_rate, ...item }) => item
      )
    );

    expect(options).toEqual({ discountIncludesVat: false });
  });
});
