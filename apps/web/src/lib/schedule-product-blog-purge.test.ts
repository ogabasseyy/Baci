import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLookup = vi.fn();
const mockSchedule = vi.fn();
const mockExpire = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/get-published-blog-post-slugs-for-products', () => ({
  getPublishedBlogPostSlugsForProducts: (...args: unknown[]) =>
    mockLookup(...args),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) => mockSchedule(...args),
}));
vi.mock('@/lib/expire-product-blog-cache-reliable', () => ({
  expireProductBlogCacheReliable: (...args: unknown[]) => mockExpire(...args),
}));

import { scheduleProductBlogPurge } from './schedule-product-blog-purge';

const supabase = {} as never;
const entries = [{ slug: 'pixel-11', categorySegment: 'smartphones' }];

function makeBlogPostIdSupabase(rows: unknown[], error: unknown = null) {
  const inQuery = vi.fn().mockResolvedValue({ data: rows, error });
  const chain = {
    eq: vi.fn(() => chain),
    in: inQuery,
    not: vi.fn(() => chain),
    select: vi.fn(() => chain),
  };
  return {
    client: { from: vi.fn(() => chain) } as never,
    inQuery,
  };
}

describe('scheduleProductBlogPurge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLookup.mockResolvedValue([]);
  });

  it('looks up linked articles and schedules them with category fallbacks', async () => {
    mockLookup.mockResolvedValue(['Pixel-Guide', 'pixel-guide']);

    await scheduleProductBlogPurge({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: ' store ',
      productIds: ['product-1'],
      entries,
      categorySlugs: ['smartphones', null, ''],
    });

    expect(mockLookup).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      ['product-1'],
      ['smartphones']
    );
    expect(mockSchedule).toHaveBeenCalledWith('store', entries, {
      blogPostSlugs: ['Pixel-Guide', 'pixel-guide'],
    });
    expect(mockExpire).toHaveBeenCalledWith('merchant-1');
  });

  it('uses a pre-delete snapshot without querying cascaded relationships', async () => {
    await scheduleProductBlogPurge({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      productIds: ['product-1'],
      entries,
      blogPostSlugs: ['Guide-A', 'guide-a', ' guide-b '],
    });

    expect(mockLookup).not.toHaveBeenCalled();
    expect(mockSchedule).toHaveBeenCalledWith('store', entries, {
      blogPostSlugs: ['Guide-A', 'guide-a', 'guide-b'],
    });
  });

  it('resolves pre-delete relationship IDs after the mutation commits', async () => {
    const { client, inQuery } = makeBlogPostIdSupabase([
      { slug: 'pixel-guide', status: 'published', published_at: '2026-09-01' },
      { slug: 'draft-guide', status: 'draft', published_at: null },
    ]);

    await scheduleProductBlogPurge({
      supabase: client,
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      productIds: ['product-1'],
      entries,
      blogPostIds: ['11111111-1111-4111-8111-111111111111'],
    });

    expect(inQuery).toHaveBeenCalledWith('id', [
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(mockSchedule).toHaveBeenCalledWith('store', entries, {
      blogPostSlugs: ['pixel-guide'],
    });
  });

  it('preserves mixed-case linked article slugs for case-sensitive cache keys', async () => {
    await scheduleProductBlogPurge({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      productIds: ['product-1'],
      entries,
      blogPostSlugs: ['Best-Phones-2026'],
    });

    expect(mockSchedule).toHaveBeenCalledWith('store', entries, {
      blogPostSlugs: ['Best-Phones-2026'],
    });
  });

  it('merges a pre-delete snapshot with post-delete category fallback posts', async () => {
    mockLookup.mockResolvedValue(['category-guide']);

    await scheduleProductBlogPurge({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      productIds: ['product-1'],
      entries,
      blogPostSlugs: ['direct-guide'],
      categorySlugs: ['smartphones'],
    });

    expect(mockLookup).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      [],
      ['smartphones']
    );
    expect(mockSchedule).toHaveBeenCalledWith('store', entries, {
      blogPostSlugs: ['direct-guide', 'category-guide'],
    });
  });

  it('is a no-op when the public merchant slug or entries are missing', async () => {
    await scheduleProductBlogPurge({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: ' ',
      productIds: ['product-1'],
      entries,
    });
    await scheduleProductBlogPurge({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      productIds: ['product-1'],
      entries: [],
    });

    expect(mockLookup).not.toHaveBeenCalled();
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockExpire).not.toHaveBeenCalled();
  });

  it('can resolve linked posts after an immediate product purge without duplicating an empty purge', async () => {
    await scheduleProductBlogPurge({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      productIds: ['product-1'],
      entries,
      skipWhenNoLinkedPosts: true,
    });

    expect(mockExpire).toHaveBeenCalledWith('merchant-1');
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('schedules only blog URLs when the core product purge already ran', async () => {
    mockLookup.mockResolvedValue(['pixel-guide']);

    await scheduleProductBlogPurge({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      productIds: ['product-1'],
      entries,
      skipProductPurge: true,
    });

    expect(mockSchedule).toHaveBeenCalledWith('store', entries, {
      blogPostSlugs: ['pixel-guide'],
      blogPostsOnly: true,
    });
  });

  it('does not restore a core purge when deferred-only lookup fails', async () => {
    mockLookup.mockRejectedValue(new Error('temporary read failure'));

    await scheduleProductBlogPurge({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      productIds: ['product-1'],
      entries,
      skipProductPurge: true,
    });

    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('retains pre-delete blog slugs when category fallback lookup fails', async () => {
    mockLookup.mockRejectedValue(new Error('temporary read failure'));

    await scheduleProductBlogPurge({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      productIds: ['product-1'],
      entries,
      blogPostSlugs: ['direct-guide'],
      categorySlugs: ['smartphones'],
    });

    expect(mockSchedule).toHaveBeenCalledWith('store', entries, {
      blogPostSlugs: ['direct-guide'],
    });
  });

  it('swallows lookup failures so product mutations remain successful', async () => {
    mockLookup.mockRejectedValue(new Error('temporary read failure'));

    await expect(
      scheduleProductBlogPurge({
        supabase,
        merchantId: 'merchant-1',
        merchantSlug: 'store',
        productIds: ['product-1'],
        entries,
      })
    ).resolves.toBeUndefined();

    expect(mockSchedule).toHaveBeenCalledWith('store', entries);
  });
});
