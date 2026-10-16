import { describe, expect, it, vi } from 'vitest';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const VARIANT_ID = '22222222-2222-4222-8222-222222222222';
const MERCHANT_ID = '33333333-3333-4333-8333-333333333333';

function createQueryChain(data: unknown[], error: unknown = null) {
  const chain = {
    eq: vi.fn(),
    in: vi.fn(),
    returns: vi.fn().mockResolvedValue({ data: error ? null : data, error }),
    select: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return chain;
}

function createCheckoutSupabase(productQuery: unknown, variantQuery: unknown) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'products') {
        return productQuery;
      }
      if (table === 'product_variants') {
        return variantQuery;
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

describe('calculateCheckoutSession line identity', () => {
  it('produces the same line id for reordered variant attributes', async () => {
    const productQuery = createQueryChain([
      {
        id: PRODUCT_ID,
        manage_stock: false,
        name: 'Phone',
        price: 500000,
        stock: 0,
        stock_quantity: 0,
      },
    ]);
    const variantQuery = createQueryChain([]);
    const supabase = createCheckoutSupabase(productQuery, variantQuery);
    const first = await calculateCheckoutSession(
      supabase as never,
      [
        {
          id: PRODUCT_ID,
          quantity: 1,
          variant_attributes: { Color: 'Red', Size: 'L' },
        },
      ],
      null,
      'NGN',
      MERCHANT_ID
    );
    const second = await calculateCheckoutSession(
      supabase as never,
      [
        {
          id: PRODUCT_ID,
          quantity: 1,
          variant_attributes: { Size: 'L', Color: 'Red' },
        },
      ],
      null,
      'NGN',
      MERCHANT_ID
    );
    expect(first.lineItems[0]?.id).toBe(second.lineItems[0]?.id);
  });

  it('gives sibling variant lanes distinct line ids', async () => {
    const productQuery = createQueryChain([
      {
        id: PRODUCT_ID,
        manage_stock: false,
        name: 'Phone',
        price: 500000,
        stock: 0,
        stock_quantity: 0,
      },
    ]);
    const variantQuery = createQueryChain([
      {
        attributes: { color: 'Black' },
        id: VARIANT_ID,
        merchant_id: MERCHANT_ID,
        price_override: 550000,
        product: { manage_stock: false, name: 'Phone', price: 500000 },
        product_id: PRODUCT_ID,
        stock_quantity: 0,
      },
      {
        attributes: { color: 'White' },
        id: '44444444-4444-4444-8444-444444444444',
        merchant_id: MERCHANT_ID,
        price_override: 560000,
        product: { manage_stock: false, name: 'Phone', price: 500000 },
        product_id: PRODUCT_ID,
        stock_quantity: 0,
      },
    ]);
    const supabase = createCheckoutSupabase(productQuery, variantQuery);

    const result = await calculateCheckoutSession(
      supabase as never,
      [
        { id: PRODUCT_ID, quantity: 1, variant_id: VARIANT_ID },
        {
          id: PRODUCT_ID,
          quantity: 1,
          variant_id: '44444444-4444-4444-8444-444444444444',
        },
      ],
      null,
      'NGN',
      MERCHANT_ID
    );

    const ids = result.lineItems.map((line) => line.id);
    expect(new Set(ids).size).toBe(2);
  });
});
