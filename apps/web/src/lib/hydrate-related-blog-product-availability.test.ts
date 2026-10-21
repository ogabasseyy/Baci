import { describe, expect, it, vi } from 'vitest';
import type { RelatedBlogProduct } from '@/lib/related-blog-products';
import { hydrateRelatedBlogProductAvailability } from './hydrate-related-blog-product-availability';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

function product(
  overrides: Partial<RelatedBlogProduct> = {}
): RelatedBlogProduct {
  return {
    id: PRODUCT_ID,
    name: 'iPhone 16',
    slug: 'iphone-16',
    category_slug: 'smartphones',
    manage_stock: true,
    stock: 0,
    has_condition_offers: true,
    ...overrides,
  };
}

function authorityRow(
  offerId: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    product_id: PRODUCT_ID,
    offer_id: offerId,
    condition: 'used',
    price_basis: 120000,
    allocatable_stock: 2,
    parent_eligible: true,
    ...extra,
  };
}

const VARIANT_PRODUCT_ID = '123e4567-e89b-12d3-a456-426614174000';

describe('hydrateRelatedBlogProductAvailability', () => {
  it('marks an empty primary product as available when an active condition offer has stock', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [authorityRow('offer-1')],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product()]
    );

    expect(result[0]?.has_purchasable_condition_offer).toBe(true);
    expect(rpc).toHaveBeenCalledWith('get_storefront_offer_resolution', {
      p_merchant_id: null,
      p_product_ids: [PRODUCT_ID],
    });
  });

  it('ignores a stocked offer that carries the parent product condition', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        authorityRow('offer-1', {
          condition: 'New',
          price_basis: 150000,
          allocatable_stock: 2,
        }),
        authorityRow('offer-2', {
          condition: 'used',
          price_basis: 120000,
          allocatable_stock: 0,
        }),
      ],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product({ condition: 'new' })]
    );

    // The PDP excludes same-condition rows from selectable offers, so the
    // stocked 'New' row must neither mark the rail available nor advertise.
    expect(result[0]?.has_purchasable_condition_offer).toBe(false);
    expect(result[0]?.offers).toEqual([
      {
        condition: 'used',
        price: 120000,
        status: 'active',
        stock_quantity: 0,
      },
    ]);
  });

  it('keeps a stocked offer with a different condition than the parent', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        authorityRow('offer-1', {
          condition: 'Used',
          price_basis: 120000,
          allocatable_stock: 2,
        }),
      ],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product({ condition: 'new' })]
    );

    expect(result[0]?.has_purchasable_condition_offer).toBe(true);
    expect(result[0]?.offers).toEqual([
      {
        condition: 'Used',
        price: 120000,
        status: 'active',
        stock_quantity: 2,
      },
    ]);
  });

  it('marks an empty primary product unavailable when every active offer is empty', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        authorityRow('offer-1', { allocatable_stock: 0 }),
        authorityRow('offer-2', { allocatable_stock: 0 }),
      ],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product()]
    );

    expect(result[0]?.has_purchasable_condition_offer).toBe(false);
  });

  it('marks an unbounded offer allocation purchasable, never zero stock', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        authorityRow('offer-1', {
          allocatable_stock: null,
          effective_policy: 'serialized_then_unlimited',
        }),
      ],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product()]
    );

    expect(result[0]?.has_purchasable_condition_offer).toBe(true);
  });

  it('fails closed to zero when a non-unlimited policy has no allocation', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        authorityRow('offer-1', {
          allocatable_stock: null,
          effective_policy: 'legacy',
        }),
      ],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product()]
    );

    expect(result[0]?.has_purchasable_condition_offer).toBe(false);
  });

  it('matches an uppercase caller id to a lowercase live row', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [authorityRow('offer-1')],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product({ id: PRODUCT_ID.toUpperCase() })]
    );

    expect(result[0]?.has_purchasable_condition_offer).toBe(true);
  });

  it('omits a gated row a partial projection still carries', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [authorityRow('offer-1', { parent_eligible: false })],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product()]
    );

    expect(result[0]?.has_purchasable_condition_offer).toBe(false);
    expect(result[0]?.offers).toEqual([]);
  });

  it('omits a stocked row without a finite price instead of pricing it at zero', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [authorityRow('offer-1', { price_basis: null })],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product()]
    );

    expect(result[0]?.has_purchasable_condition_offer).toBe(false);
    expect(result[0]?.offers).toEqual([]);
  });

  it('does not read offers for products that are not currently unavailable', async () => {
    const rpc = vi.fn();
    const products = [
      product({ stock_quantity: 3, has_condition_offers: false }),
      product({
        id: 'product-2',
        manage_stock: false,
        has_condition_offers: false,
      }),
      product({ id: 'product-3', has_condition_offers: false }),
    ];

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      products
    );

    expect(rpc).not.toHaveBeenCalled();
    expect(result).toEqual(products);
  });

  it('hydrates condition offers while primary stock is positive', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const stockedVariantProduct = product({
      stock: 3,
      stock_quantity: 3,
      has_condition_offers: true,
      has_variants: true,
      id: VARIANT_PRODUCT_ID,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [stockedVariantProduct]
    );

    expect(rpc).toHaveBeenCalledWith('get_storefront_offer_resolution', {
      p_merchant_id: null,
      p_product_ids: [VARIANT_PRODUCT_ID],
    });
    expect(result[0]).toMatchObject({
      ...stockedVariantProduct,
      has_purchasable_condition_offer: false,
      offers: [],
    });
  });

  it('hydrates condition-offer prices even while the parent stock is positive', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        authorityRow('offer-1', {
          condition: null,
          price_basis: 175000,
          allocatable_stock: 2,
        }),
      ],
      error: null,
    });
    const stockedProduct = product({
      stock: 3,
      stock_quantity: 3,
      price: 150000,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [stockedProduct]
    );

    expect(result[0]?.offers).toEqual([
      { price: 175000, status: 'active', stock_quantity: 2 },
    ]);
    expect(rpc).toHaveBeenCalledWith('get_storefront_offer_resolution', {
      p_merchant_id: null,
      p_product_ids: [PRODUCT_ID],
    });
  });

  it('keeps the current purchasable offer price for the related rail', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        authorityRow('offer-1', {
          condition: null,
          price_basis: '175000',
          allocatable_stock: '2',
        }),
      ],
      error: null,
    });

    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      [product({ price: 150000 })]
    );

    expect(result[0]?.offers).toEqual([
      { price: 175000, status: 'active', stock_quantity: 2 },
    ]);
  });

  it('fails open when the offer lookup errors', async () => {
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

      expect(result[0]?.has_purchasable_condition_offer).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('surfaces alternate lookup failures when the caller cannot cache degraded data', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'transient timeout' },
    });

    await expect(
      hydrateRelatedBlogProductAvailability({ rpc } as never, [product()], {
        throwOnError: true,
      })
    ).rejects.toThrow('transient timeout');
  });

  it('chunks past the 200-id unscoped cap instead of losing every pair', async () => {
    const chunkSizes: number[] = [];
    const rpc = vi.fn(async (...call: unknown[]) => {
      const ids = (call[1] as { p_product_ids: string[] }).p_product_ids;
      chunkSizes.push(ids.length);
      return { data: [], error: null };
    });

    const ids = Array.from(
      { length: 250 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    );
    const result = await hydrateRelatedBlogProductAvailability(
      { rpc } as never,
      ids.map((id) => product({ id }))
    );

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(chunkSizes).toEqual([200, 50]);
    expect(result).toHaveLength(250);
  });
});
