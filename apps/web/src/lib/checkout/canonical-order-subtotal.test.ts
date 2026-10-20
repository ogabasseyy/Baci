import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeCanonicalOrderSubtotal } from '@/lib/checkout/canonical-order-subtotal';

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

describe('computeCanonicalOrderSubtotal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses canonical product prices plus server assurance fees', async () => {
    const { supabase } = buildSupabaseMock({
      products: [{ id: 'p-1', price: 1000 }],
    });

    const subtotal = await computeCanonicalOrderSubtotal({
      items: [
        {
          product_id: 'p-1',
          quantity: 2,
          assurance_fee: 50,
        },
      ],
      merchantId: 'merchant-1',
      supabase: supabase as never,
    });

    expect(subtotal).toBe(2050);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('rounds canonical subtotal values with cent precision', async () => {
    const { supabase } = buildSupabaseMock({
      products: [{ id: 'p-1', price: 1.005 }],
    });

    const subtotal = await computeCanonicalOrderSubtotal({
      items: [
        {
          product_id: 'p-1',
          quantity: 1,
          assurance_fee: 0,
        },
      ],
      merchantId: 'merchant-1',
      supabase: supabase as never,
    });

    expect(subtotal).toBe(1.01);
  });

  it('uses a matching variant price override when present', async () => {
    const { supabase } = buildSupabaseMock({
      products: [{ id: 'p-1', price: 1000 }],
      variants: [{ id: 'v-1', product_id: 'p-1', price_override: 900 }],
    });

    const subtotal = await computeCanonicalOrderSubtotal({
      items: [
        {
          product_id: 'p-1',
          variant_id: 'v-1',
          quantity: 1,
          assurance_fee: 0,
        },
      ],
      merchantId: 'merchant-1',
      supabase: supabase as never,
    });

    expect(subtotal).toBe(900);
    expect(supabase.rpc).toHaveBeenCalledWith('get_order_variant_overrides', {
      p_variant_ids: ['v-1'],
    });
  });

  it('ignores a variant override that belongs to another product', async () => {
    const { supabase } = buildSupabaseMock({
      products: [{ id: 'p-1', price: '1000' }],
      variants: [{ id: 'v-1', product_id: 'p-2', price_override: 700 }],
    });

    const subtotal = await computeCanonicalOrderSubtotal({
      items: [
        {
          product_id: 'p-1',
          variant_id: 'v-1',
          quantity: 1,
          assurance_fee: 0,
        },
      ],
      merchantId: 'merchant-1',
      supabase: supabase as never,
    });

    expect(subtotal).toBe(1000);
  });

  it('throws when product prices cannot be loaded', async () => {
    const { supabase } = buildSupabaseMock({
      products: null,
      productsError: { message: 'db unavailable' },
    });

    await expect(
      computeCanonicalOrderSubtotal({
        items: [
          {
            product_id: 'p-1',
            quantity: 1,
            assurance_fee: 0,
          },
        ],
        merchantId: 'merchant-1',
        supabase: supabase as never,
      })
    ).rejects.toThrow('Unable to load products for canonical subtotal parity');
  });

  it('prices offer lines from verified live offer economics', async () => {
    const { supabase } = buildSupabaseMock({
      products: [{ id: 'p-1', price: 1000 }],
    });

    const subtotal = await computeCanonicalOrderSubtotal({
      items: [
        {
          product_id: 'p-1',
          offer_id: 'offer-1',
          quantity: 2,
          assurance_fee: 0,
        },
      ],
      merchantId: 'merchant-1',
      offerPrices: new Map([['p-1::offer-1', 800]]),
      supabase: supabase as never,
    });

    expect(subtotal).toBe(1600);
  });

  it('throws when an offer line lacks verified live offer economics', async () => {
    const { supabase } = buildSupabaseMock({
      products: [{ id: 'p-1', price: 1000 }],
    });

    await expect(
      computeCanonicalOrderSubtotal({
        items: [
          {
            product_id: 'p-1',
            offer_id: 'offer-1',
            quantity: 1,
            assurance_fee: 0,
          },
        ],
        merchantId: 'merchant-1',
        supabase: supabase as never,
      })
    ).rejects.toThrow('Offer line is missing verified live offer economics');
  });
});
