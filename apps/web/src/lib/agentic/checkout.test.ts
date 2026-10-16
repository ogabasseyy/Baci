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

describe('calculateCheckoutSession', () => {
  it('scopes product and variant lookups to the merchant', async () => {
    const productQuery = createQueryChain([
      {
        id: PRODUCT_ID,
        manage_stock: true,
        name: 'Phone',
        price: 500000,
        stock: 4,
        stock_quantity: 4,
      },
    ]);
    const variantQuery = createQueryChain([]);
    const supabase = createCheckoutSupabase(productQuery, variantQuery);

    const result = await calculateCheckoutSession(
      supabase as never,
      [{ id: PRODUCT_ID, quantity: 1 }],
      null,
      'NGN',
      MERCHANT_ID
    );

    expect(result.messages).toEqual([]);
    expect(productQuery.eq).toHaveBeenCalledWith('merchant_id', MERCHANT_ID);
    expect(variantQuery.eq).toHaveBeenCalledWith('merchant_id', MERCHANT_ID);
    expect(variantQuery.select).toHaveBeenCalledWith(
      expect.stringContaining(
        'product:products!product_variants_product_id_fkey'
      )
    );
  });

  it('treats unmanaged product stock as unlimited', async () => {
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

    const result = await calculateCheckoutSession(
      supabase as never,
      [{ id: PRODUCT_ID, quantity: 9 }],
      null,
      'NGN',
      MERCHANT_ID
    );

    expect(result.messages).toEqual([]);
  });

  it('keeps variant line items tied to parent products', async () => {
    const productQuery = createQueryChain([]);
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
    ]);
    const supabase = createCheckoutSupabase(productQuery, variantQuery);

    const result = await calculateCheckoutSession(
      supabase as never,
      [{ id: VARIANT_ID, quantity: 2 }],
      null,
      'NGN',
      MERCHANT_ID
    );

    expect(result.messages).toEqual([]);
    expect(result.lineItems[0]?.item).toMatchObject({
      id: VARIANT_ID,
      product_id: PRODUCT_ID,
      variant_attributes: { color: 'Black' },
      variant_id: VARIANT_ID,
    });
  });

  it('returns an error message instead of adding unpriced variants', async () => {
    const productQuery = createQueryChain([]);
    const variantQuery = createQueryChain([
      {
        attributes: { color: 'Black' },
        id: VARIANT_ID,
        merchant_id: MERCHANT_ID,
        price_override: null,
        product: { manage_stock: false, name: 'Phone', price: null },
        product_id: PRODUCT_ID,
        stock_quantity: 0,
      },
    ]);
    const supabase = createCheckoutSupabase(productQuery, variantQuery);

    const result = await calculateCheckoutSession(
      supabase as never,
      [{ id: VARIANT_ID, quantity: 2 }],
      null,
      'NGN',
      MERCHANT_ID
    );

    expect(result.lineItems).toEqual([]);
    expect(result.messages).toContainEqual(
      expect.objectContaining({
        code: 'missing_price',
        content: expect.stringContaining(VARIANT_ID),
        path: '$.items[0]',
        type: 'error',
      })
    );
  });

  it('prices an explicit variant lane from the variant, not the parent', async () => {
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
    ]);
    const supabase = createCheckoutSupabase(productQuery, variantQuery);

    const result = await calculateCheckoutSession(
      supabase as never,
      [{ id: PRODUCT_ID, quantity: 2, variant_id: VARIANT_ID }],
      null,
      'NGN',
      MERCHANT_ID
    );

    expect(result.messages).toEqual([]);
    expect(result.lineItems[0]?.total).toBe(1100000);
    expect(result.lineItems[0]?.item).toMatchObject({
      product_id: PRODUCT_ID,
      variant_id: VARIANT_ID,
    });
  });

  it('rejects an explicit variant lane that does not belong to the product', async () => {
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

    const result = await calculateCheckoutSession(
      supabase as never,
      [{ id: PRODUCT_ID, quantity: 1, variant_id: VARIANT_ID }],
      null,
      'NGN',
      MERCHANT_ID
    );

    expect(result.lineItems).toEqual([]);
    expect(result.messages).toContainEqual(
      expect.objectContaining({ code: 'invalid', type: 'error' })
    );
  });

  it('prices a condition lane from the active condition offer', async () => {
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
    const supabase = {
      ...createCheckoutSupabase(productQuery, variantQuery),
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            condition: 'used',
            price: 300000,
            product_id: PRODUCT_ID,
            status: 'active',
          },
        ],
        error: null,
      }),
    };

    const result = await calculateCheckoutSession(
      supabase as never,
      [{ condition: 'used', id: PRODUCT_ID, quantity: 1 }],
      null,
      'NGN',
      MERCHANT_ID
    );

    expect(result.lineItems[0]?.total).toBe(300000);
    expect(result.lineItems[0]?.item).toMatchObject({ condition: 'used' });
  });

  it('fails when product lookup returns a database error', async () => {
    const productQuery = createQueryChain([], { message: 'query failed' });
    const variantQuery = createQueryChain([]);
    const supabase = createCheckoutSupabase(productQuery, variantQuery);

    await expect(
      calculateCheckoutSession(
        supabase as never,
        [{ id: PRODUCT_ID, quantity: 1 }],
        null,
        'NGN',
        MERCHANT_ID
      )
    ).rejects.toThrow('Failed to load checkout products');
  });

  it('fails when variant lookup returns a database error', async () => {
    const productQuery = createQueryChain([]);
    const variantQuery = createQueryChain([], { message: 'query failed' });
    const supabase = createCheckoutSupabase(productQuery, variantQuery);

    await expect(
      calculateCheckoutSession(
        supabase as never,
        [{ id: VARIANT_ID, quantity: 1 }],
        null,
        'NGN',
        MERCHANT_ID
      )
    ).rejects.toThrow('Failed to load checkout product variants');
  });

  it('returns an item error without querying UUID columns for malformed item IDs', async () => {
    const supabase = {
      from: vi.fn(() => {
        throw new Error('Unexpected database query');
      }),
    };

    const result = await calculateCheckoutSession(
      supabase as never,
      [{ id: 'not-a-uuid', quantity: 1 }],
      null,
      'NGN',
      MERCHANT_ID
    );

    expect(supabase.from).not.toHaveBeenCalled();
    expect(result.lineItems).toEqual([]);
    expect(result.messages).toContainEqual(
      expect.objectContaining({
        code: 'invalid',
        content: 'Item not-a-uuid not found.',
        path: '$.items[0]',
        type: 'error',
      })
    );
  });
});
