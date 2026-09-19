import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelatedBlogProduct } from '@/lib/related-blog-products';
import { hydrateRelatedBlogProductAvailability } from './hydrate-related-blog-product-availability';

const mockSerializedHydrate = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hydrate-related-blog-product-serialized-inventory', () => ({
  hydrateRelatedBlogProductSerializedInventory: mockSerializedHydrate,
}));

const VARIANT_PRODUCT_ID = '123e4567-e89b-12d3-a456-426614174000';

function product(
  overrides: Partial<RelatedBlogProduct> = {}
): RelatedBlogProduct {
  return {
    id: VARIANT_PRODUCT_ID,
    name: 'iPhone 16',
    slug: 'iphone-16',
    category_slug: 'smartphones',
    manage_stock: true,
    stock: 0,
    has_condition_offers: false,
    has_variants: true,
    ...overrides,
  };
}

describe('hydrateRelatedBlogProductAvailability variant paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps a managed product available when a public variant has stock', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ product_id: VARIANT_PRODUCT_ID, stock_quantity: 3 }],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product()]
    );

    expect(result[0]?.has_purchasable_variant).toBe(true);
    expect(rpc).toHaveBeenCalledWith('get_storefront_product_variants', {
      p_product_ids: [VARIANT_PRODUCT_ID],
    });
  });

  it('uses canonical serialized units for a stale parent stock value', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'variant-serialized',
          product_id: VARIANT_PRODUCT_ID,
          stock_quantity: 0,
        },
      ],
      error: null,
    });
    const variantProduct = product({ stock: 5, stock_quantity: 5 });
    mockSerializedHydrate.mockResolvedValue([
      {
        ...variantProduct,
        has_purchasable_variant: true,
        variants: [
          {
            id: 'variant-serialized',
            inventory_tracking_policy: 'serialized_strict',
            stock_quantity: 1,
          },
        ],
      },
    ]);

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [variantProduct],
      { merchantId: 'merchant-1' }
    );

    expect(mockSerializedHydrate).toHaveBeenCalledWith(
      expect.objectContaining({ rpc }),
      'merchant-1',
      expect.arrayContaining([
        expect.objectContaining({ id: VARIANT_PRODUCT_ID }),
      ])
    );
    expect(result[0]?.has_purchasable_variant).toBe(true);
  });

  it('keeps a purchasable variant price for the related rail', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          product_id: VARIANT_PRODUCT_ID,
          price_override: '175000',
          stock_quantity: 2,
        },
      ],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product({ price: 150000 })]
    );

    expect(result[0]?.variants).toEqual([
      { price_override: 175000, stock_quantity: 2 },
    ]);
  });

  it('marks a managed product unavailable when every public variant is empty', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ product_id: VARIANT_PRODUCT_ID, stock_quantity: 0 }],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product()]
    );

    expect(result[0]?.has_purchasable_variant).toBe(false);
  });

  it('inherits parent stock when a public variant omits its own quantity', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ product_id: VARIANT_PRODUCT_ID, stock_quantity: null }],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product({ stock: 5, stock_quantity: 5 })],
      { merchantId: 'merchant-1' }
    );

    expect(result[0]?.has_purchasable_variant).toBe(true);
  });

  it('fails open when the public variant lookup errors', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'timeout' },
    });

    try {
      const result = await hydrateRelatedBlogProductAvailability(
        { rpc } as never,
        [product()]
      );

      expect(result[0]?.has_purchasable_variant).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
