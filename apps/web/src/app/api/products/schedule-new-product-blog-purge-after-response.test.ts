import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSchedule, mockResolveCategory } = vi.hoisted(() => ({
  mockSchedule: vi.fn(),
  mockResolveCategory: vi.fn(() => 'smartphones'),
}));

vi.mock('@/lib/schedule-product-blog-purge-after-response', () => ({
  scheduleProductBlogPurgeAfterResponse: mockSchedule,
}));
vi.mock('@/lib/storefront-product-purge-urls', () => ({
  resolveProductPurgeCategorySegment: mockResolveCategory,
}));

import { scheduleNewProductBlogPurgeAfterResponse } from './schedule-new-product-blog-purge-after-response';

describe('scheduleNewProductBlogPurgeAfterResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues active-product relationship enrichment without blocking the create response', () => {
    const supabase = {} as never;

    scheduleNewProductBlogPurgeAfterResponse({
      category: 'Smartphones',
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      name: 'Pixel 11',
      productId: 'product-1',
      slug: 'pixel-11',
      status: 'active',
      supabase,
    });

    expect(mockSchedule).toHaveBeenCalledWith({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      productIds: ['product-1'],
      entries: [{ slug: 'pixel-11', categorySegment: 'smartphones' }],
      categorySlugs: ['Smartphones'],
      skipWhenNoLinkedPosts: true,
    });
  });

  it('does not queue a public blog lookup for draft products', () => {
    scheduleNewProductBlogPurgeAfterResponse({
      category: 'Smartphones',
      merchantId: 'merchant-1',
      name: 'Draft phone',
      productId: 'product-2',
      slug: 'draft-phone',
      status: 'draft',
      supabase: {} as never,
    });

    expect(mockSchedule).not.toHaveBeenCalled();
  });
});
