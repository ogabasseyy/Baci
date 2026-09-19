import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { getOrderedBlogPostProductLinks } from '@/lib/ordered-blog-post-product-links';

describe('getOrderedBlogPostProductLinks', () => {
  it('orders a post’s embedded product links by the author-selected position', async () => {
    const query = {
      eq: vi.fn(),
      order: vi.fn(),
    };
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    const select = vi.fn(() => query);
    const from = vi.fn(() => ({ select }));

    await getOrderedBlogPostProductLinks(
      { from } as unknown as SupabaseClient,
      'merchant-1',
      'post-1'
    );

    expect(from).toHaveBeenCalledWith('blog_post_products');
    expect(select).toHaveBeenCalledWith(
      'product_id, relationship, product:products!blog_post_products_product_id_fkey(id, name, slug, status, price, compare_at_price, min_variant_price, max_variant_price, stock, stock_quantity, manage_stock, has_condition_offers, has_variants, categories:category_id(slug))'
    );
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(query.eq).toHaveBeenCalledWith('blog_post_id', 'post-1');
    expect(query.order).toHaveBeenCalledWith('position', { ascending: true });
  });

  it('retries the legacy deterministic order when the position column is absent before migration', async () => {
    const canonicalQuery = {
      eq: vi.fn(),
      order: vi.fn(),
    };
    canonicalQuery.eq.mockReturnValue(canonicalQuery);
    canonicalQuery.order.mockReturnValue(canonicalQuery);
    Object.defineProperty(canonicalQuery, 'then', {
      value: (resolve: (value: unknown) => void) =>
        Promise.resolve({
          data: null,
          error: {
            code: '42703',
            message: 'column blog_post_products.position does not exist',
          },
        }).then(resolve),
    });
    const legacyResult = {
      data: [{ product: { id: 'product-a' } }],
      error: null,
    };
    const legacyQuery = {
      eq: vi.fn(),
      order: vi.fn(),
    };
    legacyQuery.eq.mockReturnValue(legacyQuery);
    legacyQuery.order.mockReturnValue(legacyQuery);
    Object.defineProperty(legacyQuery, 'then', {
      value: (resolve: (value: unknown) => void) =>
        Promise.resolve(legacyResult).then(resolve),
    });
    const select = vi
      .fn()
      .mockReturnValueOnce(canonicalQuery)
      .mockReturnValueOnce(legacyQuery);
    const from = vi.fn(() => ({ select }));

    const result = await getOrderedBlogPostProductLinks(
      { from } as unknown as SupabaseClient,
      'merchant-1',
      'post-1'
    );

    expect(result).toEqual(legacyResult);
    expect(canonicalQuery.order).toHaveBeenCalledWith('position', {
      ascending: true,
    });
    expect(legacyQuery.order).toHaveBeenNthCalledWith(1, 'created_at', {
      ascending: true,
    });
    expect(legacyQuery.order).toHaveBeenNthCalledWith(2, 'id', {
      ascending: true,
    });
  });

  it('preserves unrelated missing-column errors without retrying', async () => {
    const canonicalResult = {
      data: null,
      error: {
        code: '42703',
        message: 'column blog_post_products.created_at does not exist',
      },
    };
    const query = { eq: vi.fn(), order: vi.fn() };
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    Object.defineProperty(query, 'then', {
      value: (resolve: (value: unknown) => void) =>
        Promise.resolve(canonicalResult).then(resolve),
    });
    const select = vi.fn(() => query);
    const from = vi.fn(() => ({ select }));

    const result = await getOrderedBlogPostProductLinks(
      { from } as unknown as SupabaseClient,
      'merchant-1',
      'post-1'
    );

    expect(result).toEqual(canonicalResult);
    expect(select).toHaveBeenCalledTimes(1);
  });
});
