import { describe, expect, it, vi } from 'vitest';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import { computeAgenticOrderTax } from '@/lib/agentic/checkout-order-tax';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const VARIANT_ID = '22222222-2222-4222-8222-222222222222';
const MERCHANT_ID = '33333333-3333-4333-8333-333333333333';

function createQueryChain(data: unknown[], error: unknown = null) {
  const chain = {
    eq: vi.fn(),
    in: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: data[0] ?? null, error }),
    returns: vi.fn().mockResolvedValue({ data: error ? null : data, error }),
    select: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return chain;
}

function createCheckoutSupabase(
  productQuery: unknown,
  variantQuery: unknown,
  vatRegistrationStatus = 'not_registered'
) {
  const merchantQuery = createQueryChain([
    { vat_registration_status: vatRegistrationStatus },
  ]);
  return {
    from: vi.fn((table: string) => {
      if (table === 'merchants') return merchantQuery;
      if (table === 'products') {
        return productQuery;
      }
      if (table === 'product_variants') {
        return variantQuery;
      }
      throw new Error(`Unexpected table ${table}`);
    }),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
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

  it('includes registered VAT and selected shipping in the authorized checkout total', async () => {
    const productQuery = createQueryChain([
      {
        id: PRODUCT_ID,
        manage_stock: false,
        name: 'Phone',
        price: 1.05,
        stock: 0,
        stock_quantity: 0,
        vat_category_code: 'S',
        vat_rate: 7.5,
      },
    ]);
    const variantQuery = createQueryChain([]);
    const supabase = createCheckoutSupabase(
      productQuery,
      variantQuery,
      'registered'
    );
    const result = await calculateCheckoutSession(
      supabase as never,
      [{ id: PRODUCT_ID, quantity: 3 }],
      'shipping_standard',
      'NGN',
      MERCHANT_ID
    );

    expect(result.lineItems[0]?.tax).toBe(0.24);
    expect(result.totals).toEqual([
      {
        type: 'items_base_amount',
        display_text: 'Items Subtotal',
        amount: 3.15,
      },
      { type: 'fulfillment', display_text: 'Shipping', amount: 2500 },
      { type: 'tax', display_text: 'Tax', amount: 0.24 },
      { type: 'total', display_text: 'Total Due', amount: 2503.39 },
    ]);
    const dispatchedTax = await computeAgenticOrderTax({
      items: result.lineItems.map((line) => ({
        product_id: line.item.product_id,
        quantity: line.item.quantity,
        variant_id: line.item.variant_id,
      })),
      merchantId: MERCHANT_ID,
      supabase: supabase as never,
    });
    expect(dispatchedTax).toBe(
      result.totals.find((total) => total.type === 'tax')?.amount
    );
  });

  it('keeps VAT at zero for non-registered merchants', async () => {
    const productQuery = createQueryChain([
      {
        id: PRODUCT_ID,
        manage_stock: false,
        name: 'Phone',
        price: 100,
        stock: 0,
        stock_quantity: 0,
        vat_category_code: 'S',
        vat_rate: 7.5,
      },
    ]);
    const result = await calculateCheckoutSession(
      createCheckoutSupabase(productQuery, createQueryChain([])) as never,
      [{ id: PRODUCT_ID, quantity: 2 }],
      null,
      'NGN',
      MERCHANT_ID
    );

    expect(result.lineItems[0]?.tax).toBe(0);
    expect(result.totals.find((total) => total.type === 'tax')?.amount).toBe(0);
    expect(result.totals.find((total) => total.type === 'total')?.amount).toBe(
      200
    );
  });

  it('uses the parent product VAT category for variant checkout lines', async () => {
    const variantQuery = createQueryChain([
      {
        id: VARIANT_ID,
        merchant_id: MERCHANT_ID,
        product_id: PRODUCT_ID,
        price_override: 1.05,
        stock_quantity: 0,
        attributes: { color: 'Black' },
        product: {
          name: 'Phone',
          price: 2,
          manage_stock: false,
          vat_category_code: 'Z',
          vat_rate: 20,
        },
      },
    ]);
    const result = await calculateCheckoutSession(
      createCheckoutSupabase(
        createQueryChain([]),
        variantQuery,
        'registered'
      ) as never,
      [{ id: VARIANT_ID, quantity: 3 }],
      null,
      'NGN',
      MERCHANT_ID
    );

    expect(result.lineItems[0]?.base_amount).toBe(3.15);
    expect(result.lineItems[0]?.tax).toBe(0);
    expect(result.totals.find((total) => total.type === 'tax')?.amount).toBe(0);
    expect(result.totals.find((total) => total.type === 'total')?.amount).toBe(
      3.15
    );
    const dispatchedTax = await computeAgenticOrderTax({
      items: result.lineItems.map((line) => ({
        product_id: line.item.product_id,
        variant_id: line.item.variant_id,
        quantity: line.item.quantity,
      })),
      merchantId: MERCHANT_ID,
      supabase: createCheckoutSupabase(
        createQueryChain([
          {
            id: PRODUCT_ID,
            price: 2,
            vat_category_code: 'Z',
            vat_rate: 20,
          },
        ]),
        createQueryChain([]),
        'registered'
      ) as never,
    });
    expect(dispatchedTax).toBe(0);
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

  it('preserves requested option-only attributes without a variant lane', async () => {
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
      [
        {
          id: PRODUCT_ID,
          quantity: 1,
          variant_attributes: { engraving: 'Ada' },
        },
      ],
      null,
      'NGN',
      MERCHANT_ID
    );

    expect(result.lineItems[0]?.item.variant_attributes).toEqual({
      engraving: 'Ada',
    });
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
