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

describe('hydrateRelatedBlogProductAvailability offer authority', () => {
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
