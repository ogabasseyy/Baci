import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRevalidatePath = vi.fn();
const mockRevalidateTag = vi.fn();
const mockPurgeCloudflareUrls = vi.fn();
const mockAfter = vi.fn((callback: () => unknown) => callback());

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}));
vi.mock('next/server', () => ({
  after: (callback: () => unknown) => mockAfter(callback),
}));
vi.mock('@/lib/cloudflare-purge', () => ({
  purgeCloudflareUrls: (...args: unknown[]) => mockPurgeCloudflareUrls(...args),
}));
vi.mock('@/lib/storefront-purge-urls', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/storefront-purge-urls')>();
  return {
    ...actual,
    buildStorefrontBlogPurgeUrls: vi.fn(actual.buildStorefrontBlogPurgeUrls),
  };
});

import { revalidateBlogPosts } from '@/lib/cache-revalidation';
import { buildStorefrontBlogPurgeUrls } from '@/lib/storefront-purge-urls';

describe('revalidateBlogPosts Cloudflare purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('purges post images and category listings for a matched custom domain', () => {
    revalidateBlogPosts({
      identifiers: ['ogabassey'],
      listingCategories: ['Buying Guides', 'Reviews', 'Buying Guides'],
      postSlugs: ['test-post', 'Test-Post'],
    });

    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(mockPurgeCloudflareUrls).toHaveBeenCalledWith([
      'https://ogabassey.com/blog',
      'https://ogabassey.com/blog/news-sitemap.xml',
      'https://ogabassey.com/blog/sitemap.xml',
      'https://ogabassey.com/blog/test-post',
      'https://ogabassey.com/blog/test-post/opengraph-image',
      'https://ogabassey.com/blog/category/buying-guides',
      'https://ogabassey.com/blog/category/reviews',
      'https://ogabassey.com/blog/author/bassey-john',
      'https://ogabassey.com/blog/author/bolakale',
      'https://www.ogabassey.com/blog',
      'https://www.ogabassey.com/blog/news-sitemap.xml',
      'https://www.ogabassey.com/blog/sitemap.xml',
      'https://www.ogabassey.com/blog/test-post',
      'https://www.ogabassey.com/blog/test-post/opengraph-image',
      'https://www.ogabassey.com/blog/category/buying-guides',
      'https://www.ogabassey.com/blog/category/reviews',
      'https://www.ogabassey.com/blog/author/bassey-john',
      'https://www.ogabassey.com/blog/author/bolakale',
    ]);
  });

  it('purges the post image without category listings when none changed', () => {
    revalidateBlogPosts({
      identifiers: ['ogabassey'],
      postSlugs: ['test-post'],
    });

    expect(mockPurgeCloudflareUrls).toHaveBeenCalledWith([
      'https://ogabassey.com/blog',
      'https://ogabassey.com/blog/news-sitemap.xml',
      'https://ogabassey.com/blog/sitemap.xml',
      'https://ogabassey.com/blog/test-post',
      'https://ogabassey.com/blog/test-post/opengraph-image',
      'https://ogabassey.com/blog/author/bassey-john',
      'https://ogabassey.com/blog/author/bolakale',
      'https://www.ogabassey.com/blog',
      'https://www.ogabassey.com/blog/news-sitemap.xml',
      'https://www.ogabassey.com/blog/sitemap.xml',
      'https://www.ogabassey.com/blog/test-post',
      'https://www.ogabassey.com/blog/test-post/opengraph-image',
      'https://www.ogabassey.com/blog/author/bassey-john',
      'https://www.ogabassey.com/blog/author/bolakale',
    ]);
  });

  it('does not purge storefronts without a public cache policy', () => {
    revalidateBlogPosts({
      identifiers: ['some-other-store'],
      postSlugs: ['test-post'],
    });

    expect(mockPurgeCloudflareUrls).not.toHaveBeenCalled();
  });

  it('keeps Next revalidation successful when purge URL construction fails', () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    vi.mocked(buildStorefrontBlogPurgeUrls).mockImplementationOnce(() => {
      throw new Error('purge URL build failed');
    });

    const act = () =>
      revalidateBlogPosts({
        identifiers: ['ogabassey'],
        postSlugs: ['test-post'],
      });

    expect(act).not.toThrow();
    expect(mockRevalidateTag).toHaveBeenCalledWith('blog-posts', 'merchant');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/ogabassey/blog');
    expect(mockPurgeCloudflareUrls).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Skipped Cloudflare blog purge scheduling',
      { error: expect.any(Error) }
    );

    warnSpy.mockRestore();
  });
});
