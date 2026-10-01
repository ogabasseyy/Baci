import {
  buildTransactionDiscountLineKey,
  buildTransactionDiscountLineOccurrenceKey,
} from '@baci/shared/contracts';
import { describe, expect, it, vi } from 'vitest';
import { computeOrderNegotiationDiscount } from './order-negotiation-discount';

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

function buildSupabaseMock(
  products = [
    {
      brand: 'Apple',
      id: 'p-mac',
      name: 'MacBook Air M1',
      price: 1000,
      condition: 'new',
      vat_category_code: 'S',
      vat_rate: 7.5,
    },
  ]
) {
  const productsQuery = {
    select: () => productsQuery,
    eq: () => productsQuery,
    in: () => productsQuery,
    overrideTypes: () => Promise.resolve({ data: products, error: null }),
  };

  return {
    from: () => productsQuery,
    rpc: () => Promise.resolve({ data: [], error: null }),
  };
}

describe('computeOrderNegotiationDiscount persisted line identity', () => {
  it('preserves distinct condition and variant attributes for duplicate product lines', async () => {
    const result = await computeOrderNegotiationDiscount({
      items: [
        {
          condition: 'new',
          price: 980,
          product_id: 'p-mac',
          quantity: 1,
          variant_attributes: { Color: 'Blue' },
          variant_id: 'v-mac',
        },
        {
          condition: 'used',
          price: 980,
          product_id: 'p-mac',
          quantity: 1,
          variant_attributes: { Color: 'Green' },
          variant_id: 'v-mac',
        },
      ],
      merchantId: 'merchant-1',
      supabase: buildSupabaseMock() as never,
      vatRegistered: true,
    });

    expect(result).toMatchObject({
      rejectionCode: null,
      totalDiscount: 43,
    });
    expect(result?.lineDiscounts).toEqual([
      {
        lineId: 1,
        lineKey: buildTransactionDiscountLineKey({
          condition: 'new',
          productId: 'p-mac',
          variantAttributes: { Color: 'Blue' },
          variantId: 'v-mac',
        }),
        merchandiseDiscount: 20,
        productId: 'p-mac',
        vatRelief: 1.5,
        variantId: 'v-mac',
      },
      {
        lineId: 2,
        lineKey: buildTransactionDiscountLineKey({
          condition: 'used',
          productId: 'p-mac',
          variantAttributes: { Color: 'Green' },
          variantId: 'v-mac',
        }),
        merchandiseDiscount: 20,
        productId: 'p-mac',
        vatRelief: 1.5,
        variantId: 'v-mac',
      },
    ]);
  });

  it('uses the catalog condition when duplicate lines omit their condition', async () => {
    const result = await computeOrderNegotiationDiscount({
      items: [
        {
          price: 980,
          product_id: 'p-mac',
          quantity: 1,
          variant_attributes: { Color: 'Blue' },
          variant_id: 'v-mac',
        },
        {
          price: 980,
          product_id: 'p-mac',
          quantity: 1,
          variant_attributes: { Color: 'Green' },
          variant_id: 'v-mac',
        },
      ],
      merchantId: 'merchant-1',
      supabase: buildSupabaseMock() as never,
      vatRegistered: true,
    });

    expect(result?.lineDiscounts).toEqual([
      expect.objectContaining({
        lineKey: buildTransactionDiscountLineKey({
          condition: 'new',
          productId: 'p-mac',
          variantAttributes: { Color: 'Blue' },
          variantId: 'v-mac',
        }),
      }),
      expect.objectContaining({
        lineKey: buildTransactionDiscountLineKey({
          condition: 'new',
          productId: 'p-mac',
          variantAttributes: { Color: 'Green' },
          variantId: 'v-mac',
        }),
      }),
    ]);
  });

  it('counts a voucher line when assigning duplicate occurrence keys', async () => {
    const result = await computeOrderNegotiationDiscount({
      items: [
        {
          condition: 'new',
          price: 0,
          product_id: 'p-mac',
          quantity: 1,
          variant_id: null,
          voucher_award_id: 'award-1',
        },
        {
          condition: 'new',
          price: 980,
          product_id: 'p-mac',
          quantity: 1,
          variant_id: null,
        },
        {
          condition: 'new',
          price: 980,
          product_id: 'p-mac',
          quantity: 1,
          variant_id: null,
        },
      ],
      merchantId: 'merchant-1',
      supabase: buildSupabaseMock() as never,
      vatRegistered: true,
    });
    const lineKey = buildTransactionDiscountLineKey({
      condition: 'new',
      productId: 'p-mac',
      variantId: null,
    });

    expect(result).toEqual({
      lineDiscounts: [
        null,
        {
          lineId: 2,
          lineKey: buildTransactionDiscountLineOccurrenceKey(lineKey, 2),
          merchandiseDiscount: 20,
          productId: 'p-mac',
          vatRelief: 1.5,
          variantId: null,
        },
        {
          lineId: 3,
          lineKey: buildTransactionDiscountLineOccurrenceKey(lineKey, 3),
          merchandiseDiscount: 20,
          productId: 'p-mac',
          vatRelief: 1.5,
          variantId: null,
        },
      ],
      rejectionCode: null,
      totalDiscount: 43,
    });
  });

  it('persists a full key when a voucher shares identity with merchandise', async () => {
    const result = await computeOrderNegotiationDiscount({
      items: [
        {
          condition: 'used',
          price: 0,
          product_id: 'p-mac',
          quantity: 1,
          variant_attributes: { Color: 'Red' },
          variant_id: null,
          voucher_award_id: 'award-1',
        },
        {
          condition: 'new',
          price: 980,
          product_id: 'p-mac',
          quantity: 1,
          variant_attributes: { Color: 'Blue' },
          variant_id: null,
        },
        {
          condition: 'new',
          price: 1960,
          product_id: 'p-other',
          quantity: 1,
          variant_attributes: {},
          variant_id: null,
        },
      ],
      merchantId: 'merchant-1',
      supabase: buildSupabaseMock([
        {
          brand: 'Apple',
          id: 'p-mac',
          name: 'MacBook Air M1',
          price: 1000,
          condition: 'new',
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
        {
          brand: 'Apple',
          id: 'p-other',
          name: 'iPad Mini',
          price: 2000,
          condition: 'new',
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ]) as never,
      vatRegistered: true,
    });

    expect(result?.lineDiscounts?.[1]).toEqual(
      expect.objectContaining({
        lineKey: buildTransactionDiscountLineKey({
          condition: 'new',
          productId: 'p-mac',
          variantAttributes: { Color: 'Blue' },
          variantId: null,
        }),
      })
    );
    expect(result?.lineDiscounts?.[2]).toEqual(
      expect.objectContaining({
        lineId: 3,
        merchandiseDiscount: 40,
      })
    );
    expect(result?.lineDiscounts?.[2]).not.toHaveProperty('lineKey');
  });
});
