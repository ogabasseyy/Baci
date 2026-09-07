import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  liveBlogPost,
  mockConnection,
  mockDraftMode,
  mockGetBlogPostRedirect,
  mockGetBlogPostTextPreview,
  mockGetRequestScopedBlogPost,
  mockNotFound,
  mockPermanentRedirect,
  resetBlogPostPageMocks,
} from './page.test-utils';

async function generateBlogPostMetadata(postSlug: string) {
  const { generateMetadata } = await import('./page');

  return generateMetadata({
    params: Promise.resolve({
      slug: 'ogabassey.com',
      postSlug,
    }),
  });
}

describe('storefront blog post metadata', () => {
  beforeEach(() => {
    resetBlogPostPageMocks();
  });

  it('resolves public metadata from the cached lookup without request APIs', async () => {
    mockDraftMode.mockResolvedValue({ isEnabled: true });
    mockGetRequestScopedBlogPost.mockResolvedValue(liveBlogPost);

    const metadata = await generateBlogPostMetadata(
      'apple-studio-display-review'
    );

    expect(mockGetRequestScopedBlogPost).toHaveBeenCalledWith(
      'ogabassey.com',
      'apple-studio-display-review',
      false
    );
    const expectedTitle = 'The Great 5K Stall | Ogabassey';
    expect(metadata.title).toEqual({ absolute: expectedTitle });
    expect(metadata.openGraph).toEqual(
      expect.objectContaining({ title: expectedTitle })
    );
    expect(metadata.twitter).toEqual(
      expect.objectContaining({ title: expectedTitle })
    );
    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.com/blog/apple-studio-display-review'
    );
    // Request APIs in generateMetadata force the whole document dynamic under
    // cacheComponents + htmlLimitedBots — the exact NEXT_STATIC_GEN_BAILOUT
    // this route shipped with connection() first (PR #2882 regression guard).
    expect(mockConnection).not.toHaveBeenCalled();
    expect(mockDraftMode).not.toHaveBeenCalled();
  });

  it('keeps a descriptive long blog post title complete while preserving its single merchant suffix', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...liveBlogPost,
      post: {
        ...liveBlogPost.post,
        title:
          'Best Phones Under 500000 Naira in Nigeria With Camera Battery and Gaming Performance Compared',
        excerpt:
          'Compare the best phones under 500000 naira in Nigeria with camera quality, battery life, gaming performance, warranty coverage, delivery options, and flexible payment notes for shoppers.',
      },
    });

    const metadata = await generateBlogPostMetadata('best-phones-under-500000');

    const title = (metadata.title as { absolute: string }).absolute;
    expect(title).toBe(
      'Best Phones Under 500000 Naira in Nigeria With Camera Battery and Gaming Performance Compared | Ogabassey'
    );
    expect(title).not.toContain('...');
    expect(typeof metadata.description).toBe('string');
    if (typeof metadata.description !== 'string') {
      throw new TypeError('metadata.description must be a string');
    }
    expect(metadata.description.length).toBeLessThanOrEqual(160);
  });

  it('sanitizes a blog SEO title and adds the merchant suffix once', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...liveBlogPost,
      post: {
        ...liveBlogPost.post,
        seo_title:
          '<script>alert(1)</script> Itel Power 80 Review | Ogabassey | Ogabassey',
      },
    });

    const metadata = await generateBlogPostMetadata('itel-power-80-review');

    expect(metadata.title).toEqual({
      absolute: 'alert(1) Itel Power 80 Review | Ogabassey',
    });
    expect(metadata.openGraph).toEqual(
      expect.objectContaining({
        title: 'alert(1) Itel Power 80 Review | Ogabassey',
      })
    );
  });

  it('falls back safely when blog title values are empty after sanitization', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...liveBlogPost,
      post: {
        ...liveBlogPost.post,
        seo_title: '<span> </span>',
        title: '   ',
      },
    });

    const metadata = await generateBlogPostMetadata('empty-title');

    expect(metadata.title).toEqual({ absolute: 'Blog Post | Ogabassey' });
  });

  it('uses fallback blog description metadata when source text is empty', async () => {
    mockGetBlogPostTextPreview.mockReturnValueOnce('');
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...liveBlogPost,
      post: {
        ...liveBlogPost.post,
        seo_description: '',
        excerpt: '',
        content: '',
      },
    });

    const metadata = await generateBlogPostMetadata('empty-description');

    expect(metadata.description).toContain(
      'Read The Great 5K Stall from Ogabassey'
    );
    expect(typeof metadata.description).toBe('string');
    if (typeof metadata.description !== 'string') {
      throw new TypeError('metadata.description must be a string');
    }
    expect(metadata.description.length).toBeLessThanOrEqual(160);
  });

  it('preserves short blog metadata that is already within bounds', async () => {
    const boundedDescription =
      'A practical buying guide for Nigerian shoppers comparing display quality, delivery confidence, warranty support, and upgrade timing.';
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...liveBlogPost,
      post: {
        ...liveBlogPost.post,
        seo_title: 'Studio Display Review',
        seo_description: boundedDescription,
      },
    });

    const metadata = await generateBlogPostMetadata('studio-display-review');

    expect(metadata.title).toEqual({
      absolute: 'Studio Display Review | Ogabassey',
    });
    expect(metadata.description).toBe(boundedDescription);
  });

  it('keeps min-length blog descriptions when they are already descriptive', async () => {
    const descriptiveSummary =
      'Compare phone options by camera quality, battery life, warranty confidence, delivery timing, payment flexibility, and everyday value.';
    expect(descriptiveSummary.length).toBeGreaterThanOrEqual(110);
    expect(descriptiveSummary.length).toBeLessThanOrEqual(160);
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...liveBlogPost,
      post: {
        ...liveBlogPost.post,
        seo_description: descriptiveSummary,
      },
    });

    const metadata = await generateBlogPostMetadata('descriptive-summary');

    expect(metadata.description).toBe(descriptiveSummary);
  });

  it('returns noindex fallback metadata when the public cache lookup throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    mockGetRequestScopedBlogPost.mockRejectedValue(
      new Error('Cache lookup failed')
    );

    const metadata = await generateBlogPostMetadata(
      'apple-studio-display-review'
    );

    expect(metadata.robots).toMatchObject({ index: false, follow: false });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error fetching cached public blog metadata',
      expect.objectContaining({
        slug: 'ogabassey.com',
        postSlug: 'apple-studio-display-review',
        error: expect.any(Error),
      })
    );
    consoleErrorSpy.mockRestore();
  });

  it('rethrows framework control-flow errors from the cached lookup unswallowed', async () => {
    // Swallowed prerender-interrupt errors are how the route previously logged
    // 'unable to determine a reason' — unstable_rethrow must let them escape.
    mockGetRequestScopedBlogPost.mockRejectedValue(new Error('NEXT_NOT_FOUND'));

    await expect(generateBlogPostMetadata('interrupted-post')).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
  });

  it('returns noindex fallback metadata for draft-only slugs without draft gating', async () => {
    mockDraftMode.mockResolvedValue({ isEnabled: true });
    mockGetRequestScopedBlogPost.mockResolvedValue(null);

    const metadata = await generateBlogPostMetadata('draft-only-post');

    expect(mockDraftMode).not.toHaveBeenCalled();
    expect(mockGetBlogPostRedirect).not.toHaveBeenCalled();
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it('returns cacheable noindex metadata for retired slugs instead of redirecting', async () => {
    // The hard 308 for retired slugs is owned by the proxy blog-post
    // preflight; metadata must stay cacheable and side-effect free.
    mockGetRequestScopedBlogPost.mockResolvedValue(null);
    mockGetBlogPostRedirect.mockResolvedValue({
      merchant: {
        id: 'merchant-1',
        business_name: 'Ogabassey',
        slug: 'ogabassey',
        custom_domain: 'ogabassey.com',
      },
      targetSlug: 'canonical-post',
    });

    const metadata = await generateBlogPostMetadata('retired-post');

    expect(metadata.robots).toMatchObject({ index: false, follow: false });
    expect(mockGetBlogPostRedirect).not.toHaveBeenCalled();
    expect(mockPermanentRedirect).not.toHaveBeenCalled();
    expect(mockConnection).not.toHaveBeenCalled();
  });

  it('returns cacheable noindex metadata for missing slugs instead of notFound', async () => {
    // The hard 404 for missing slugs is owned by the proxy blog-post
    // preflight; a notFound() here would force the route dynamic again.
    mockGetRequestScopedBlogPost.mockResolvedValue(null);
    mockGetBlogPostRedirect.mockResolvedValue(null);

    const metadata = await generateBlogPostMetadata('missing-post');

    expect(metadata.robots).toMatchObject({ index: false, follow: false });
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(mockConnection).not.toHaveBeenCalled();
  });

  it('returns cacheable noindex metadata for over-encoded bot post slugs without the cached lookup', async () => {
    let overEncodedPostSlug = 'best phones in nigeria';
    for (let i = 0; i < 10; i++) {
      overEncodedPostSlug = encodeURIComponent(overEncodedPostSlug);
    }

    const metadata = await generateBlogPostMetadata(overEncodedPostSlug);

    expect(metadata.title).toBe('Blog Post');
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
    expect(mockGetRequestScopedBlogPost).not.toHaveBeenCalled();
  });

  it('returns cacheable noindex metadata for extremely long post slugs without the cached lookup', async () => {
    const metadata = await generateBlogPostMetadata('a'.repeat(4000));

    expect(metadata.title).toBe('Blog Post');
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
    expect(mockGetRequestScopedBlogPost).not.toHaveBeenCalled();
  });

  it('uses canonical URL from buildCanonicalBlogPostUrl for custom domains', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...liveBlogPost,
      merchant: {
        ...liveBlogPost.merchant,
        custom_domain: 'ogabassey.com',
      },
    });

    const metadata = await generateBlogPostMetadata(
      'apple-studio-display-review'
    );

    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.com/blog/apple-studio-display-review'
    );
  });

  it('uses the cached landscape asset directly for OpenGraph and Twitter metadata', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...liveBlogPost,
      post: {
        ...liveBlogPost.post,
        featured_image_variants: {
          landscape_16x9:
            'https://cdn.ogabassey.com/image/format=auto/core-assets/blog/apple-landscape_16x9.jpg',
        },
      },
    });

    const metadata = await generateBlogPostMetadata(
      'apple-studio-display-review'
    );

    expect(metadata.openGraph?.images).toEqual([
      {
        alt: 'The Great 5K Stall — Ogabassey',
        height: 675,
        type: 'image/jpeg',
        url: 'https://cdn.ogabassey.com/image/width=1200,quality=75,format=jpeg/core-assets/blog/apple-landscape_16x9.jpg',
        width: 1200,
      },
    ]);
    expect(metadata.twitter?.images).toEqual([
      'https://cdn.ogabassey.com/image/width=1200,quality=75,format=jpeg/core-assets/blog/apple-landscape_16x9.jpg',
    ]);
  });
});
