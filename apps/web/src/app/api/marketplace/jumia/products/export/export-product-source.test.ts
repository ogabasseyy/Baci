import { describe, expect, it, vi } from 'vitest';
import {
  parseExportProductImages,
  resolveAuthorizedExportProduct,
} from './export-product-source';

describe('parseExportProductImages', () => {
  it('maps string and object image entries into Jumia feed images', () => {
    expect(
      parseExportProductImages([
        'https://cdn.example.com/one.jpg',
        { url: 'https://cdn.example.com/two.jpg' },
        { url: 'javascript:alert(1)' },
      ])
    ).toEqual([
      { url: 'https://cdn.example.com/one.jpg', primary: true },
      { url: 'https://cdn.example.com/two.jpg', primary: false },
    ]);
  });

  it('rejects root-relative and blank image URLs', () => {
    expect(
      parseExportProductImages([
        '/images/product.jpg',
        '   ',
        { url: '//cdn.example.com/protocol-relative.jpg' },
        { url: 'https://cdn.example.com/safe.jpg' },
      ])
    ).toEqual([{ url: 'https://cdn.example.com/safe.jpg', primary: true }]);
  });

  it('marks the first safe image as primary even when unsafe entries precede it', () => {
    expect(
      parseExportProductImages([
        { url: 'javascript:alert(1)' },
        'https://cdn.example.com/primary.jpg',
        'https://cdn.example.com/secondary.jpg',
      ])
    ).toEqual([
      { url: 'https://cdn.example.com/primary.jpg', primary: true },
      { url: 'https://cdn.example.com/secondary.jpg', primary: false },
    ]);
  });
});

function createProductSupabase(handlers: {
  product?: Record<string, unknown> | null;
  productError?: unknown;
  variants?: Record<string, unknown>[];
  variantsError?: unknown;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: handlers.product ?? null,
    error: handlers.productError ?? null,
  });
  const variantsResult = {
    data: handlers.variants ?? [],
    error: handlers.variantsError ?? null,
  };
  return {
    from: vi.fn((table: string) => {
      if (table === 'products') {
        const chain = { eq: vi.fn(), maybeSingle };
        chain.eq.mockReturnValue(chain);
        return { select: vi.fn().mockReturnValue(chain) };
      }
      if (table === 'product_variants') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue(variantsResult),
            }),
          }),
        };
      }
      return {};
    }),
  };
}

describe('resolveAuthorizedExportProduct', () => {
  it('builds export variations from the merchant-owned product record', async () => {
    const supabase = createProductSupabase({
      product: {
        id: 'prod-1',
        name: 'Phone',
        description: 'A phone',
        price: 100,
        sku: 'SKU-1',
        stock_quantity: 4,
        stock: 4,
        images: [{ url: 'https://cdn.example.com/phone.jpg' }],
        has_variants: false,
      },
    });

    const result = await resolveAuthorizedExportProduct(
      supabase as never,
      'merchant-1',
      'prod-1',
      'GHS'
    );

    expect(result).toEqual({
      ok: true,
      product: expect.objectContaining({
        productId: 'prod-1',
        name: 'Phone',
        variations: [
          { sellerSku: 'SKU-1', price: 100, currency: 'GHS', stock: 4 },
        ],
        variantIdsBySku: new Map(),
      }),
    });
  });

  it('exports the legacy stock value when stock_quantity drifted to zero', async () => {
    const supabase = createProductSupabase({
      product: {
        id: 'prod-1',
        name: 'Phone',
        description: 'A phone',
        price: 100,
        sku: 'SKU-1',
        stock_quantity: 0,
        stock: 7,
        images: [],
        has_variants: false,
      },
    });

    const result = await resolveAuthorizedExportProduct(
      supabase as never,
      'merchant-1',
      'prod-1',
      'GHS'
    );

    expect(result).toEqual({
      ok: true,
      product: expect.objectContaining({
        variations: [
          { sellerSku: 'SKU-1', price: 100, currency: 'GHS', stock: 7 },
        ],
      }),
    });
  });

  it('omits stock when both stock fields are null', async () => {
    const supabase = createProductSupabase({
      product: {
        id: 'prod-1',
        name: 'Phone',
        description: 'A phone',
        price: 100,
        sku: 'SKU-1',
        stock_quantity: null,
        stock: null,
        images: [],
        has_variants: false,
      },
    });

    const result = await resolveAuthorizedExportProduct(
      supabase as never,
      'merchant-1',
      'prod-1',
      'GHS'
    );

    expect(result).toEqual({
      ok: true,
      product: expect.objectContaining({
        variations: [
          {
            sellerSku: 'SKU-1',
            price: 100,
            currency: 'GHS',
            stock: undefined,
          },
        ],
      }),
    });
  });

  it('returns 404 when the product is missing', async () => {
    const result = await resolveAuthorizedExportProduct(
      createProductSupabase({ product: null }) as never,
      'merchant-1',
      'prod-1',
      'NGN'
    );

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Product not found',
    });
  });

  it('returns 500 when the product query fails', async () => {
    const result = await resolveAuthorizedExportProduct(
      createProductSupabase({
        product: null,
        productError: { message: 'DB down' },
      }) as never,
      'merchant-1',
      'prod-1',
      'NGN'
    );

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Failed to load product for Jumia export',
    });
  });

  it('returns 500 when the variant query fails', async () => {
    const result = await resolveAuthorizedExportProduct(
      createProductSupabase({
        product: {
          id: 'prod-1',
          name: 'Phone',
          price: 100,
          sku: 'SKU-1',
          stock_quantity: 4,
          stock: 4,
          images: [],
          has_variants: true,
        },
        variantsError: { message: 'variant query failed' },
      }) as never,
      'merchant-1',
      'prod-1',
      'NGN'
    );

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Failed to load product variants for Jumia export',
    });
  });

  it('returns 400 when the product has no SKU', async () => {
    const result = await resolveAuthorizedExportProduct(
      createProductSupabase({
        product: {
          id: 'prod-1',
          name: 'Phone',
          price: 100,
          sku: '   ',
          stock_quantity: 4,
          stock: 4,
          images: [],
          has_variants: false,
        },
      }) as never,
      'merchant-1',
      'prod-1',
      'NGN'
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Product must have a SKU before it can be exported to Jumia',
    });
  });

  it('returns 400 when variant SKUs are duplicated', async () => {
    const result = await resolveAuthorizedExportProduct(
      createProductSupabase({
        product: {
          id: 'prod-1',
          name: 'Phone',
          price: 100,
          sku: 'PARENT',
          stock_quantity: 4,
          stock: 4,
          images: [],
          has_variants: true,
        },
        variants: [
          {
            id: 'variant-1',
            sku: 'SKU-1',
            price_override: 110,
            stock_quantity: 2,
          },
          {
            id: 'variant-2',
            sku: 'SKU-1',
            price_override: 120,
            stock_quantity: 3,
          },
        ],
      }) as never,
      'merchant-1',
      'prod-1',
      'NGN'
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Product variants must have unique SKUs before export to Jumia',
    });
  });

  it('returns 400 when a sellable variant is missing a SKU', async () => {
    const result = await resolveAuthorizedExportProduct(
      createProductSupabase({
        product: {
          id: 'prod-1',
          name: 'Phone',
          price: 100,
          sku: 'PARENT',
          stock_quantity: 4,
          stock: 4,
          images: [],
          has_variants: true,
        },
        variants: [
          {
            id: 'variant-1',
            sku: 'SKU-1',
            price_override: 110,
            stock_quantity: 2,
          },
          {
            id: 'variant-2',
            sku: '   ',
            price_override: 120,
            stock_quantity: 3,
          },
        ],
      }) as never,
      'merchant-1',
      'prod-1',
      'NGN'
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Every product variant must have a SKU before export to Jumia',
    });
  });

  it('ignores inventory-anchor variants and exports serialized simple products by parent SKU', async () => {
    const result = await resolveAuthorizedExportProduct(
      createProductSupabase({
        product: {
          id: 'prod-1',
          name: 'Phone',
          description: 'A phone',
          price: 250,
          sku: 'PHONE-SKU',
          stock_quantity: 6,
          stock: 6,
          images: [{ url: 'https://cdn.example.com/phone.jpg' }],
          has_variants: false,
        },
        variants: [
          {
            id: 'anchor-variant',
            sku: 'PHONE-SKU-ANCHOR',
            price_override: 0,
            stock_quantity: 6,
            is_inventory_anchor: true,
          },
        ],
      }) as never,
      'merchant-1',
      'prod-1',
      'NGN'
    );

    expect(result).toEqual({
      ok: true,
      product: expect.objectContaining({
        productId: 'prod-1',
        name: 'Phone',
        variations: [
          { sellerSku: 'PHONE-SKU', price: 250, currency: 'NGN', stock: 6 },
        ],
        variantIdsBySku: new Map(),
      }),
    });
  });

  it('maps two variant SKUs to their variant ids', async () => {
    const result = await resolveAuthorizedExportProduct(
      createProductSupabase({
        product: {
          id: 'prod-1',
          name: 'Phone',
          price: 100,
          sku: 'PARENT',
          stock_quantity: 0,
          stock: 0,
          images: [],
          has_variants: true,
        },
        variants: [
          {
            id: 'variant-1',
            sku: 'SKU-1',
            price_override: 110,
            stock_quantity: 2,
          },
          {
            id: 'variant-2',
            sku: 'SKU-2',
            price_override: null,
            stock_quantity: 3,
          },
        ],
      }) as never,
      'merchant-1',
      'prod-1',
      'GHS'
    );

    expect(result).toEqual({
      ok: true,
      product: {
        productId: 'prod-1',
        name: 'Phone',
        description: undefined,
        images: [],
        variations: [
          { sellerSku: 'SKU-1', price: 110, currency: 'GHS', stock: 2 },
          { sellerSku: 'SKU-2', price: 100, currency: 'GHS', stock: 3 },
        ],
        variantIdsBySku: new Map([
          ['SKU-1', 'variant-1'],
          ['SKU-2', 'variant-2'],
        ]),
      },
    });
  });
});
