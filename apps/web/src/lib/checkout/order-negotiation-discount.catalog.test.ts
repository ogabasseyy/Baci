import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeOrderNegotiationDiscount } from '@/lib/checkout/order-negotiation-discount';

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

function buildSupabaseMock({
  products = [],
  productsError = null,
  variants = [],
  variantsError = null,
}: {
  products?: unknown[] | null;
  productsError?: unknown;
  variants?: unknown[] | null;
  variantsError?: unknown;
}) {
  const productsQuery = {
    select: vi.fn(() => productsQuery),
    eq: vi.fn(() => productsQuery),
    in: vi.fn(() => productsQuery),
    returns: vi.fn(() =>
      Promise.resolve({ data: products, error: productsError })
    ),
    overrideTypes: vi.fn(() =>
      Promise.resolve({ data: products, error: productsError })
    ),
  };
  const supabase = {
    from: vi.fn(() => productsQuery),
    rpc: vi.fn(() => Promise.resolve({ data: variants, error: variantsError })),
  };

  return { productsQuery, supabase };
}

const sProduct = (over: Record<string, unknown>) => ({
  vat_category_code: 'S',
  vat_rate: 7.5,
  ...over,
});

describe('computeOrderNegotiationDiscount catalog cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives a per-line discount for a negotiated catalog line (VAT-registered)', async () => {
    const { supabase } = buildSupabaseMock({
      products: [
        sProduct({
          id: 'p-mac',
          name: 'MacBook Air M1',
          brand: 'Apple',
          price: 1000,
        }),
      ],
    });

    await expect(
      computeOrderNegotiationDiscount({
        items: [{ product_id: 'p-mac', quantity: 1, price: 980 }],
        merchantId: 'merchant-1',
        supabase: supabase as never,
        vatRegistered: true,
      })
    ).resolves.toEqual({
      lineDiscounts: [
        {
          lineId: 1,
          merchandiseDiscount: 20,
          productId: 'p-mac',
          vatRelief: 1.5,
          variantId: null,
        },
      ],
      totalDiscount: 21.5,
      rejectionCode: null,
    });
  });

  it('omits the VAT gross-up for a non-registered merchant', async () => {
    const { supabase } = buildSupabaseMock({
      products: [
        sProduct({
          id: 'p-mac',
          name: 'MacBook Air M1',
          brand: 'Apple',
          price: 1000,
        }),
      ],
    });

    // No VAT charged → discount is just the 20 price reduction, not 21.5.
    await expect(
      computeOrderNegotiationDiscount({
        items: [{ product_id: 'p-mac', quantity: 1, price: 980 }],
        merchantId: 'merchant-1',
        supabase: supabase as never,
        vatRegistered: false,
      })
    ).resolves.toEqual({
      lineDiscounts: [
        {
          lineId: 1,
          merchandiseDiscount: 20,
          productId: 'p-mac',
          vatRelief: 0,
          variantId: null,
        },
      ],
      totalDiscount: 20,
      rejectionCode: null,
    });
  });

  it('flags a non-negotiable line priced below catalog', async () => {
    const { supabase } = buildSupabaseMock({
      products: [
        sProduct({
          id: 'p-tecno',
          name: 'Tecno Spark 50',
          brand: 'Tecno',
          price: 500,
        }),
      ],
    });

    await expect(
      computeOrderNegotiationDiscount({
        items: [{ product_id: 'p-tecno', quantity: 1, price: 480 }],
        merchantId: 'merchant-1',
        supabase: supabase as never,
        vatRegistered: true,
      })
    ).resolves.toEqual({
      totalDiscount: 0,
      rejectionCode: 'non_negotiable_line_discounted',
    });
  });

  it('honors only the eligible line in a mixed cart', async () => {
    const { supabase } = buildSupabaseMock({
      products: [
        sProduct({
          id: 'p-mac',
          name: 'MacBook Air M1',
          brand: 'Apple',
          price: 1000,
        }),
        sProduct({
          id: 'p-tecno',
          name: 'Tecno Spark 50',
          brand: 'Tecno',
          price: 500,
        }),
      ],
    });

    await expect(
      computeOrderNegotiationDiscount({
        items: [
          { product_id: 'p-mac', quantity: 1, price: 980 },
          { product_id: 'p-tecno', quantity: 1, price: 500 },
        ],
        merchantId: 'merchant-1',
        supabase: supabase as never,
        vatRegistered: true,
      })
    ).resolves.toEqual({
      lineDiscounts: [
        {
          lineId: 1,
          merchandiseDiscount: 20,
          productId: 'p-mac',
          vatRelief: 1.5,
          variantId: null,
        },
        null,
      ],
      totalDiscount: 21.5,
      rejectionCode: null,
    });
  });

  it('exempts a verified quiz-voucher award line (price 0)', async () => {
    const { supabase } = buildSupabaseMock({
      products: [
        sProduct({
          id: 'p-award',
          name: 'Free Gift',
          brand: 'Apple',
          price: 5000,
        }),
      ],
    });

    // Pure-voucher order → voucher line excluded → productIds empty → null
    // (no products query, no rejection), even though price 0 ≪ catalog 5000.
    await expect(
      computeOrderNegotiationDiscount({
        items: [
          {
            product_id: 'p-award',
            quantity: 1,
            price: 0,
            voucher_award_id: 'award-1',
          },
        ],
        merchantId: 'merchant-1',
        supabase: supabase as never,
        vatRegistered: true,
      })
    ).resolves.toBeNull();
  });

  it('validates the non-voucher line in a cart that also has a voucher line', async () => {
    const { supabase } = buildSupabaseMock({
      products: [
        sProduct({
          id: 'p-mac',
          name: 'MacBook Air M1',
          brand: 'Apple',
          price: 1000,
        }),
      ],
    });

    await expect(
      computeOrderNegotiationDiscount({
        items: [
          {
            product_id: 'p-award',
            quantity: 1,
            price: 0,
            voucher_award_id: 'award-1',
          }, // exempt
          { product_id: 'p-mac', quantity: 1, price: 980 }, // validated → 21.5
        ],
        merchantId: 'merchant-1',
        supabase: supabase as never,
        vatRegistered: true,
      })
    ).resolves.toEqual({
      lineDiscounts: [
        null,
        {
          lineId: 2,
          merchandiseDiscount: 20,
          productId: 'p-mac',
          vatRelief: 1.5,
          variantId: null,
        },
      ],
      totalDiscount: 21.5,
      rejectionCode: null,
    });
  });
});
