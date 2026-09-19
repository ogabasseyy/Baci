import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  hasPermission: vi.fn(),
  resolveAccess: vi.fn(),
}));

vi.mock('@/app/api/merchant/features/resolve-selected-merchant-access', () => ({
  resolveSelectedMerchantAccess: mocks.resolveAccess,
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticate,
  hasPermission: mocks.hasPermission,
}));

import { getBlogPost } from './get-blog-post';

describe('getBlogPost', () => {
  it('returns only the selected merchant post with its ordered embedded products', async () => {
    const postQuery = {
      eq: vi.fn(),
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'post-1', slug: 'summer', title: 'Summer' },
        error: null,
      }),
    };
    postQuery.select.mockReturnValue(postQuery);
    postQuery.eq.mockReturnValue(postQuery);
    const productQuery = {
      eq: vi.fn(),
      order: vi.fn().mockResolvedValue({
        data: [{ product_id: 'product-1' }, { product_id: 'product-2' }],
        error: null,
      }),
      select: vi.fn(),
    };
    productQuery.select.mockReturnValue(productQuery);
    productQuery.eq.mockReturnValue(productQuery);
    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(postQuery)
        .mockReturnValueOnce(productQuery),
    };
    mocks.authenticate.mockResolvedValue({
      supabase,
      user: { id: 'user-1' },
    });
    mocks.resolveAccess.mockResolvedValue({
      access: { merchantId: 'merchant-1', role: 'owner' },
      invalidMerchantId: false,
    });
    mocks.hasPermission.mockReturnValue(true);

    const response = await getBlogPost(
      new NextRequest(
        'http://localhost/api/merchant/blog/posts/post-1?merchantId=merchant-1'
      ),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(await response.json()).toEqual({
      embedded_products: ['product-1', 'product-2'],
      id: 'post-1',
      slug: 'summer',
      title: 'Summer',
    });
    expect(postQuery.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(productQuery.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(productQuery.eq).toHaveBeenCalledWith('blog_post_id', 'post-1');
  });

  it('retries ordered embedded-product hydration after the pre-migration position-column error', async () => {
    const postQuery = {
      eq: vi.fn(),
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'post-1', slug: 'summer', title: 'Summer' },
        error: null,
      }),
    };
    postQuery.select.mockReturnValue(postQuery);
    postQuery.eq.mockReturnValue(postQuery);
    const canonicalProductQuery = {
      eq: vi.fn(),
      order: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: '42703',
          message: 'column blog_post_products.position does not exist',
        },
      }),
      select: vi.fn(),
    };
    canonicalProductQuery.select.mockReturnValue(canonicalProductQuery);
    canonicalProductQuery.eq.mockReturnValue(canonicalProductQuery);
    const legacyProductQuery = {
      eq: vi.fn(),
      order: vi.fn(),
      select: vi.fn(),
    };
    legacyProductQuery.select.mockReturnValue(legacyProductQuery);
    legacyProductQuery.eq.mockReturnValue(legacyProductQuery);
    legacyProductQuery.order
      .mockReturnValueOnce(legacyProductQuery)
      .mockResolvedValueOnce({
        data: [{ product_id: 'product-2' }, { product_id: 'product-1' }],
        error: null,
      });
    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(postQuery)
        .mockReturnValueOnce(canonicalProductQuery)
        .mockReturnValueOnce(legacyProductQuery),
    };
    mocks.authenticate.mockResolvedValue({
      supabase,
      user: { id: 'user-1' },
    });
    mocks.resolveAccess.mockResolvedValue({
      access: { merchantId: 'merchant-1', role: 'owner' },
      invalidMerchantId: false,
    });
    mocks.hasPermission.mockReturnValue(true);

    const response = await getBlogPost(
      new NextRequest(
        'http://localhost/api/merchant/blog/posts/post-1?merchantId=merchant-1'
      ),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      embedded_products: ['product-2', 'product-1'],
    });
    expect(canonicalProductQuery.select).toHaveBeenCalledWith(
      'product_id, relationship, product:products!blog_post_products_product_id_fkey(id, name, slug, status, price, compare_at_price, min_variant_price, max_variant_price, stock, stock_quantity, manage_stock, has_condition_offers, has_variants, categories:category_id(slug))'
    );
    expect(legacyProductQuery.select).toHaveBeenCalledWith(
      'product_id, relationship, product:products!blog_post_products_product_id_fkey(id, name, slug, status, price, compare_at_price, min_variant_price, max_variant_price, stock, stock_quantity, manage_stock, has_condition_offers, has_variants, categories:category_id(slug))'
    );
    expect(canonicalProductQuery.order).toHaveBeenCalledWith('position', {
      ascending: true,
    });
    expect(legacyProductQuery.order).toHaveBeenNthCalledWith(1, 'created_at', {
      ascending: true,
    });
    expect(legacyProductQuery.order).toHaveBeenNthCalledWith(2, 'id', {
      ascending: true,
    });
  });
});
