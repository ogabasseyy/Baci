import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ----

const mockPurgeCloudflareUrls = vi.fn();
const mockPurgeCloudflareHostnamesConfirmed = vi.fn();
const mockAfter = vi.fn((callback: () => unknown) => {
  callback();
});

vi.mock('next/server', () => ({
  after: (callback: () => unknown) => mockAfter(callback),
}));
vi.mock('@/lib/cloudflare-purge', () => ({
  purgeCloudflareUrls: (...args: unknown[]) => mockPurgeCloudflareUrls(...args),
  purgeCloudflareHostnamesConfirmed: (...args: unknown[]) =>
    mockPurgeCloudflareHostnamesConfirmed(...args),
}));
// Keep the real URL builder (so purge-URL assertions run against real output)
// but make it spy-able so one test can force it to throw.
vi.mock('@/lib/storefront-product-purge-urls', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/storefront-product-purge-urls')
    >();
  return {
    ...actual,
    buildStorefrontProductPurgeUrls: vi.fn(
      actual.buildStorefrontProductPurgeUrls
    ),
  };
});

import { buildStorefrontProductPurgeUrls } from '@/lib/storefront-product-purge-urls';
// ---- Import function AFTER mocks ----
import { scheduleStorefrontProductPurge } from './storefront-product-purge';

// ---- Tests ----

describe('scheduleStorefrontProductPurge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('schedules a purge of the built URLs via after()', () => {
    scheduleStorefrontProductPurge('ogabassey', [
      { slug: 'iphone-15', categorySegment: 'smartphones' },
    ]);

    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(mockPurgeCloudflareUrls).toHaveBeenCalledWith([
      'https://ogabassey.com/',
      'https://ogabassey.com/products',
      'https://ogabassey.com/smartphones/iphone-15',
      'https://ogabassey.com/products/iphone-15',
      'https://ogabassey.com/smartphones',
      'https://www.ogabassey.com/',
      'https://www.ogabassey.com/products',
      'https://www.ogabassey.com/smartphones/iphone-15',
      'https://www.ogabassey.com/products/iphone-15',
      'https://www.ogabassey.com/smartphones',
    ]);
  });

  it('uses a bounded hostname purge that evicts every PDP past the high-cardinality threshold', () => {
    const entries = Array.from({ length: 51 }, (_, index) => ({
      slug: `product-${index}`,
      categorySegment: 'smartphones',
    }));

    scheduleStorefrontProductPurge('ogabassey', entries);

    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(mockPurgeCloudflareHostnamesConfirmed).toHaveBeenCalledWith([
      'ogabassey.com',
      'www.ogabassey.com',
    ]);
    expect(mockPurgeCloudflareUrls).not.toHaveBeenCalled();
  });

  it('includes linked blog documents in the URL purge', () => {
    scheduleStorefrontProductPurge(
      'ogabassey',
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      { blogPostSlugs: ['iphone-guide'] }
    );

    expect(mockPurgeCloudflareUrls).toHaveBeenCalledWith(
      expect.arrayContaining([
        'https://ogabassey.com/blog/iphone-guide',
        'https://ogabassey.com/blog/iphone-guide/opengraph-image',
        'https://www.ogabassey.com/blog/iphone-guide',
      ])
    );
  });

  it('can purge only linked blog documents after the product URLs were evicted', () => {
    scheduleStorefrontProductPurge(
      'ogabassey',
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      { blogPostSlugs: ['iphone-guide'], blogPostsOnly: true }
    );

    expect(mockPurgeCloudflareUrls).toHaveBeenCalledWith([
      'https://ogabassey.com/blog',
      'https://ogabassey.com/blog/iphone-guide',
      'https://ogabassey.com/blog/iphone-guide/opengraph-image',
      'https://www.ogabassey.com/blog',
      'https://www.ogabassey.com/blog/iphone-guide',
      'https://www.ogabassey.com/blog/iphone-guide/opengraph-image',
    ]);
  });

  it('purges URLs instead of hostnames at the exact 50-entry threshold', () => {
    const entries = Array.from({ length: 50 }, (_, index) => ({
      slug: `product-${index}`,
      categorySegment: 'smartphones',
    }));

    scheduleStorefrontProductPurge('ogabassey', entries);

    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(mockPurgeCloudflareUrls).toHaveBeenCalledTimes(1);
    expect(mockPurgeCloudflareHostnamesConfirmed).not.toHaveBeenCalled();
  });

  it('uses a bounded hostname purge for large article-only invalidations', () => {
    const blogPostSlugs = Array.from(
      { length: 100 },
      (_, index) => `guide-${index}`
    );

    scheduleStorefrontProductPurge(
      'ogabassey',
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      { blogPostSlugs, blogPostsOnly: true }
    );

    expect(mockPurgeCloudflareUrls).not.toHaveBeenCalled();
    expect(mockPurgeCloudflareHostnamesConfirmed).toHaveBeenCalledWith([
      'ogabassey.com',
      'www.ogabassey.com',
    ]);
  });

  it('keeps URL purges at the exact bounded target count', () => {
    vi.mocked(buildStorefrontProductPurgeUrls).mockReturnValueOnce(
      Array.from(
        { length: 300 },
        (_, index) => `https://ogabassey.com/${index}`
      )
    );

    scheduleStorefrontProductPurge(
      'ogabassey',
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      { blogPostSlugs: ['large-guide-set'] }
    );

    expect(mockPurgeCloudflareUrls).toHaveBeenCalledTimes(1);
    expect(mockPurgeCloudflareHostnamesConfirmed).not.toHaveBeenCalled();
  });

  it('does not schedule a purge for a missing identifier', () => {
    scheduleStorefrontProductPurge(undefined, [{ slug: 'iphone-15' }]);
    scheduleStorefrontProductPurge('   ', [{ slug: 'iphone-15' }]);

    expect(mockAfter).not.toHaveBeenCalled();
    expect(mockPurgeCloudflareUrls).not.toHaveBeenCalled();
  });

  it('does not schedule a purge when there are no entries', () => {
    scheduleStorefrontProductPurge('ogabassey', []);

    expect(mockAfter).not.toHaveBeenCalled();
    expect(mockPurgeCloudflareUrls).not.toHaveBeenCalled();
  });

  it('does not schedule a purge for a storefront without a public cache policy', () => {
    scheduleStorefrontProductPurge('some-other-store', [
      { slug: 'iphone-15', categorySegment: 'smartphones' },
    ]);

    expect(mockAfter).not.toHaveBeenCalled();
    expect(mockPurgeCloudflareUrls).not.toHaveBeenCalled();
  });

  it('detaches the purge when there is no request scope for after()', () => {
    mockAfter.mockImplementationOnce(() => {
      throw new Error('after() called outside a request scope');
    });

    scheduleStorefrontProductPurge('ogabassey', [
      { slug: 'iphone-15', categorySegment: 'smartphones' },
    ]);

    // Falls back to a detached purge instead of throwing.
    expect(mockPurgeCloudflareUrls).toHaveBeenCalledTimes(1);
  });

  it('never throws when the purge URL build fails', () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    vi.mocked(buildStorefrontProductPurgeUrls).mockImplementationOnce(() => {
      throw new Error('purge URL build failed');
    });

    expect(() =>
      scheduleStorefrontProductPurge('ogabassey', [
        { slug: 'iphone-15', categorySegment: 'smartphones' },
      ])
    ).not.toThrow();

    expect(mockPurgeCloudflareUrls).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Skipped Cloudflare product purge scheduling',
      {
        identifier: 'ogabassey',
        entryCount: 1,
        error: expect.any(Error),
      }
    );
    warnSpy.mockRestore();
  });
});
