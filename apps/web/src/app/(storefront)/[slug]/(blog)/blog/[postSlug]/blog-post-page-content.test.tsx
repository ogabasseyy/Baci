import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// All `vi.mock` factories below reference these mocks. Because `vi.mock` calls
// are hoisted above ordinary `const` declarations, we initialize every mock
// via `vi.hoisted` so the factories can safely resolve the identifiers at
// hoist time (rather than relying on the factory body being called lazily).
const {
  mockBlogClassificationRead,
  mockBlogPostBodyFallback,
  mockDraftMode,
  mockHeaders,
  mockNotFound,
  mockGetRequestScopedBlogPost,
  mockGetLiveBlogPost,
  mockGetBlogPostRedirect,
  mockBuildInformationalClusterModel,
  mockGenerateBlogPostSchema,
  mockSafeJsonLdStringify,
  mockBlogPostHeader,
  mockBlogPostBody,
  mockHasBlogAuthorPage,
} = vi.hoisted(() => ({
  mockBlogClassificationRead: vi.fn(),
  mockBlogPostBodyFallback: vi.fn((_props: unknown) => null as ReactNode),
  mockDraftMode: vi.fn(),
  mockHeaders: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  mockGetRequestScopedBlogPost: vi.fn(),
  mockGetLiveBlogPost: vi.fn(),
  mockGetBlogPostRedirect: vi.fn(),
  mockBuildInformationalClusterModel: vi.fn(),
  mockGenerateBlogPostSchema: vi.fn<(data: unknown) => Record<string, unknown>>(
    () => ({})
  ),
  mockSafeJsonLdStringify: vi.fn<(_schema: unknown) => string>((schema) =>
    JSON.stringify(schema)
  ),
  mockBlogPostHeader: vi.fn(({ title }: { title: string; locale?: string }) => (
    <h1>{title}</h1>
  )),
  mockBlogPostBody: vi.fn((_props?: unknown) => null),
  mockHasBlogAuthorPage: vi.fn(
    (_authorName?: unknown, _tenant?: unknown) => true
  ),
}));

vi.mock('lucide-react', () => ({
  AlertTriangle: () => null,
  ArrowLeft: () => null,
}));

vi.mock('next/headers', () => ({
  draftMode: () => mockDraftMode(),
  headers: () => mockHeaders(),
}));

vi.mock('next/image', () => ({
  default: () => null,
  getImageProps: ({
    fill: _fill,
    loader: _loader,
    preload: _preload,
    priority: _priority,
    quality: _quality,
    ...props
  }: Record<string, unknown>) => ({ props }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
  permanentRedirect: (url: string) => {
    throw new Error(`NEXT_PERMANENT_REDIRECT:${url}`);
  },
}));

vi.mock(
  '@/components/storefront/ogabassey/seo/informational-cluster-panel',
  () => ({
    InformationalClusterPanel: ({
      model,
    }: {
      model: {
        primaryCategoryLink?: { href: string; label: string } | null;
        commerceLinks?: Array<{ href: string; label: string }>;
      } | null;
    }) =>
      model ? (
        <div>
          {model.primaryCategoryLink ? (
            <a href={model.primaryCategoryLink.href}>
              {model.primaryCategoryLink.label}
            </a>
          ) : null}
          {model.commerceLinks?.map((link) => (
            <a href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      ) : null,
  })
);

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedBlogPost: (...args: unknown[]) =>
    mockGetRequestScopedBlogPost(...args),
}));

vi.mock('@/lib/live-blog-post', () => ({
  getLiveBlogPost: (...args: unknown[]) => mockGetLiveBlogPost(...args),
}));

vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => ({
    rpc: () => ({
      abortSignal: () => ({ retry: () => mockBlogClassificationRead() }),
    }),
  }),
}));

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));

vi.mock('@/lib/blog-post-redirects', () => ({
  getBlogPostRedirect: (...args: unknown[]) => mockGetBlogPostRedirect(...args),
}));

vi.mock('@/lib/routes', () => ({
  asRoute: (value: string) => value,
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: (schema: unknown) => mockSafeJsonLdStringify(schema),
  sanitizeSchemaUrl: (url: string) =>
    url.startsWith('http://') || url.startsWith('https://') ? url : '',
}));

vi.mock('@/lib/seo-utils', () => ({
  generateBlogPostSchema: (data: unknown) => mockGenerateBlogPostSchema(data),
  generateBreadcrumbSchema: () => ({}),
  generateSlug: (value: string) =>
    value
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '')
      .replace(/--+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, ''),
}));

vi.mock('@/lib/blog-organization-schema', () => ({
  buildBlogOrganizationSchema: () => ({
    '@id': 'https://ogabassey.com#organization',
    '@type': 'OnlineStore',
  }),
}));

vi.mock('@/lib/blog-authors', () => ({
  getBlogAuthorSameAs: () => ['https://www.linkedin.com/in/michael-bolakale'],
  hasBlogAuthorPage: (...args: unknown[]) => mockHasBlogAuthorPage(...args),
}));

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: (merchant: { slug: string; custom_domain?: string }) =>
    merchant.custom_domain
      ? `https://${merchant.custom_domain}`
      : `https://${merchant.slug}.usebaci.com`,
}));

vi.mock('@/lib/storefront-content/build-informational-cluster-model', () => ({
  buildInformationalClusterModel: (...args: unknown[]) =>
    mockBuildInformationalClusterModel(...args),
}));

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: (value: string) => value.includes('.'),
}));

vi.mock('./BlogPostBody', () => ({
  BlogPostBody: (props: unknown) => mockBlogPostBody(props),
}));

vi.mock('./BlogPostBodyFallback', () => ({
  BlogPostBodyFallback: (props: unknown) => mockBlogPostBodyFallback(props),
}));

vi.mock('./BlogPostHeader', () => ({
  BlogPostHeader: (props: {
    title: string;
    locale?: string;
    author_bio: string | null;
    author_name: string | null;
    author_title: string | null;
    category: string | null;
    published_at: string | null;
    reading_time_minutes: number | null;
  }) => mockBlogPostHeader(props),
}));

vi.mock('./blog-post-content', () => ({
  buildCanonicalBlogPostUrl: (
    merchant: { slug: string; custom_domain?: string },
    postSlug: string
  ) =>
    merchant.custom_domain
      ? `https://${merchant.custom_domain}/blog/${postSlug}`
      : `https://${merchant.slug}.usebaci.com/blog/${postSlug}`,
  getBlogPostTextPreview: () => 'Preview text',
}));

vi.mock('./view-counter', () => ({
  ViewCounter: () => null,
}));

import BlogPostPageContent from './blog-post-page-content';

const smartphoneGuideBlogPost = {
  merchant: {
    id: 'merchant-1',
    business_name: 'Ogabassey',
    slug: 'ogabassey',
    logo_url: null,
    custom_domain: 'ogabassey.com',
    social_media: {
      instagram: '@ogabassey',
      tiktok: 'https://www.tiktok.com/@ogabassey',
      pinterest: '@ignored-platform',
    },
  },
  post: {
    id: 'post-1',
    title: 'Best Phones in Nigeria for 2026',
    slug: 'best-phones-in-nigeria',
    content: '<p>Test</p>',
    excerpt: 'Affordable Android and iPhone picks for buyers in Nigeria.',
    featured_image_url: null,
    featured_image_alt: null,
    featured_image_variants: {},
    category: 'Smartphones',
    tags: ['budget', 'iphone', 'samsung'],
    author_name: 'Bolakale',
    author_title: null,
    author_bio: null,
    author_image_url:
      'https://cdn.ogabassey.com/merchants/ogabassey/authors/bolakale.jpg',
    published_at: '2026-03-16T10:05:33.654Z',
    updated_at: '2026-03-16T10:05:33.654Z',
    classification_revision: '11111111-1111-4111-8111-111111111111',
    seo_title: null,
    seo_description: null,
    keywords: ['android', 'battery', 'smartphones'],
    reading_time_minutes: 4,
    word_count: 800,
  },
  relatedPosts: [],
  relatedProducts: [],
};

describe('BlogPostPageContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBlogClassificationRead.mockResolvedValue({ data: [], error: null });
    mockBlogPostBody.mockReset();
    mockBlogPostBodyFallback.mockReset();
    mockGenerateBlogPostSchema.mockReset();
    mockSafeJsonLdStringify.mockReset();
    mockHasBlogAuthorPage.mockReset();
    mockBlogPostBody.mockImplementation(() => null);
    mockBlogPostBodyFallback.mockImplementation(() => null);
    mockGenerateBlogPostSchema.mockReturnValue({});
    mockSafeJsonLdStringify.mockImplementation((schema) =>
      JSON.stringify(schema)
    );
    mockHasBlogAuthorPage.mockReturnValue(true);
    mockDraftMode.mockResolvedValue({ isEnabled: false });
    mockHeaders.mockResolvedValue(
      new Headers({
        'accept-language': 'en-us,en;q=0.8',
      })
    );
    mockGetRequestScopedBlogPost.mockResolvedValue(smartphoneGuideBlogPost);
    mockGetLiveBlogPost.mockResolvedValue(null);
    mockGetBlogPostRedirect.mockResolvedValue(null);
    mockBuildInformationalClusterModel.mockResolvedValue({
      heading: 'Continue shopping smartphones',
      primaryCategoryLink: {
        href: 'https://ogabassey.com/smartphones',
        label: 'Shop more smartphones',
      },
      commerceLinks: [
        {
          href: 'https://ogabassey.com/smartphones/compare/apple-vs-samsung',
          label: 'Apple vs Samsung',
        },
      ],
      featuredProducts: [],
    });
  });

  it('matches detail classification by stable revision despite a counter-updated timestamp', async () => {
    mockBlogClassificationRead.mockResolvedValue({
      data: [
        {
          post_id: smartphoneGuideBlogPost.post.id,
          // A view-count write updates this timestamp without changing article content.
          post_updated_at: '2026-03-17T10:05:33.654Z',
          post_revision: smartphoneGuideBlogPost.post.classification_revision,
          intent: 'repair-guide',
          source: 'reviewed',
        },
      ],
      error: null,
    });
    await BlogPostPageContent({
      params: Promise.resolve({
        slug: 'ogabassey',
        postSlug: 'best-phones-in-nigeria',
      }),
    });
    expect(mockBuildInformationalClusterModel).toHaveBeenCalledWith(
      expect.objectContaining({
        post: expect.objectContaining({
          merchant_intent: 'repair-guide',
          merchant_intent_source: 'reviewed',
        }),
      })
    );
  });

  it('renders crawlable commerce links and passes the canonicalized locale', async () => {
    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    expect(
      screen.getByRole('link', { name: /shop more smartphones/i })
    ).toHaveAttribute('href', 'https://ogabassey.com/smartphones');
    expect(
      screen.getByRole('link', { name: 'Apple vs Samsung' })
    ).toHaveAttribute(
      'href',
      'https://ogabassey.com/smartphones/compare/apple-vs-samsung'
    );
    expect(mockBlogPostHeader).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'en-US',
        title: 'Best Phones in Nigeria for 2026',
      })
    );
    expect(mockBlogPostBody).toHaveBeenCalledWith(
      expect.objectContaining({
        relatedProducts: [],
      })
    );
  });

  it('passes related products through to the blog post body', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...smartphoneGuideBlogPost,
      relatedProducts: [
        {
          id: 'product-1',
          name: 'iPhone 16',
          slug: 'iphone-16',
          category_slug: 'smartphones',
        },
      ],
    });

    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    expect(mockBlogPostBody).toHaveBeenCalledWith(
      expect.objectContaining({
        relatedProducts: [
          expect.objectContaining({
            name: 'iPhone 16',
            slug: 'iphone-16',
          }),
        ],
      })
    );
  });

  it('resolves content links against the live catalog outside draft mode', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue(smartphoneGuideBlogPost);

    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    expect(mockBlogPostBody).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: expect.any(String) })
    );
  });

  it('skips dead-link resolution in draft preview so draft-to-draft links survive', async () => {
    mockDraftMode.mockResolvedValue({ isEnabled: true });
    mockGetRequestScopedBlogPost.mockResolvedValue(smartphoneGuideBlogPost);

    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    expect(mockBlogPostBody).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: undefined })
    );
  });

  it('keeps the article chrome visible while the blog body fallback streams', async () => {
    mockBlogPostBody.mockImplementation(() => {
      throw new Promise(() => {
        // Keep the blog body suspended so the nested fallback streams.
      });
    });
    mockBlogPostBodyFallback.mockImplementation(() => (
      <div>Blog body loading</div>
    ));

    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Best Phones in Nigeria for 2026',
      })
    ).toBeInTheDocument();
    expect(screen.getByText('Blog body loading')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /shop more smartphones/i })
    ).toBeInTheDocument();
  });

  it('passes persisted Discover image variants to structured data', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...smartphoneGuideBlogPost,
      post: {
        ...smartphoneGuideBlogPost.post,
        featured_image_url:
          'https://cdn.ogabassey.com/media/merchant-1/blog/original.png',
        featured_image_variants: {
          square_1x1:
            'https://cdn.ogabassey.com/media/merchant-1/blog/post/square_1x1.webp',
          landscape_16x9:
            'https://cdn.ogabassey.com/media/merchant-1/blog/post/landscape_16x9.webp',
          standard_4x3:
            'https://cdn.ogabassey.com/media/merchant-1/blog/post/standard_4x3.webp',
        },
      },
    });

    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    expect(mockGenerateBlogPostSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrls: [
          'https://cdn.ogabassey.com/media/merchant-1/blog/post/landscape_16x9.webp',
          'https://cdn.ogabassey.com/media/merchant-1/blog/post/standard_4x3.webp',
          'https://cdn.ogabassey.com/media/merchant-1/blog/post/square_1x1.webp',
        ],
      })
    );
  });

  it('normalizes publisher social handles before passing blog structured data', async () => {
    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    expect(mockGenerateBlogPostSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        publisher: expect.objectContaining({
          sameAs: [
            'https://instagram.com/ogabassey',
            'https://www.tiktok.com/@ogabassey',
          ],
        }),
      })
    );
  });

  it('emits VideoObject structured data when the actual video upload date is available', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...smartphoneGuideBlogPost,
      post: {
        ...smartphoneGuideBlogPost.post,
        content:
          '<p>Watch the unboxing: <a href="https://youtu.be/tp-AlU5FVpE?si=RGB">YouTube</a></p>',
        title: 'Google Pixel 9 Pro Fold Unboxing',
        video_upload_date: '2026-06-20T08:00:00.000Z',
      },
    });

    const { container } = render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    const jsonLdPayloads = Array.from(
      container.querySelectorAll('script[type="application/ld+json"]')
    ).map((script) => JSON.parse(script.textContent || '{}'));
    const videoSchema = jsonLdPayloads.find(
      (schema) => schema['@type'] === 'VideoObject'
    );

    expect(videoSchema).toMatchObject({
      '@type': 'VideoObject',
      embedUrl: 'https://www.youtube-nocookie.com/embed/tp-AlU5FVpE',
      thumbnailUrl: ['https://i.ytimg.com/vi/tp-AlU5FVpE/hqdefault.jpg'],
      uploadDate: '2026-06-20T08:00:00.000Z',
      url: 'https://www.youtube.com/watch?v=tp-AlU5FVpE',
    });
  });

  it('does not emit VideoObject structured data without the actual video upload date', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...smartphoneGuideBlogPost,
      post: {
        ...smartphoneGuideBlogPost.post,
        content:
          '<p>Watch the unboxing: <a href="https://youtu.be/tp-AlU5FVpE?si=RGB">YouTube</a></p>',
        title: 'Google Pixel 9 Pro Fold Unboxing',
      },
    });

    const { container } = render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    const jsonLdPayloads = Array.from(
      container.querySelectorAll('script[type="application/ld+json"]')
    ).map((script) => JSON.parse(script.textContent || '{}'));
    const videoSchema = jsonLdPayloads.find(
      (schema) => schema['@type'] === 'VideoObject'
    );

    expect(videoSchema).toBeUndefined();
  });

  it('links BlogPosting publisher to the standalone Organization entity', async () => {
    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    expect(mockGenerateBlogPostSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        publisher: expect.objectContaining({
          id: 'https://ogabassey.com#organization',
        }),
      })
    );
  });

  it('ignores non-string publisher social JSON values before structured data', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...smartphoneGuideBlogPost,
      merchant: {
        ...smartphoneGuideBlogPost.merchant,
        social_media: {
          instagram: null,
          tiktok: 'https://www.tiktok.com/@ogabassey',
          youtube: 123,
        },
      },
    });

    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    expect(mockGenerateBlogPostSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        publisher: expect.objectContaining({
          sameAs: ['https://www.tiktok.com/@ogabassey'],
        }),
      })
    );
  });

  it('does not emit generic fallback image markup for imageless posts', async () => {
    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    expect(mockGenerateBlogPostSchema).toHaveBeenCalledWith(
      expect.not.objectContaining({
        image: expect.stringContaining('opengraph-image'),
      })
    );
    expect(mockGenerateBlogPostSchema).toHaveBeenCalledWith(
      expect.not.objectContaining({
        imageUrls: expect.any(Array),
      })
    );
  });

  it('renders the featured article hero as a preload-only LCP image at the shared low quality', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...smartphoneGuideBlogPost,
      post: {
        ...smartphoneGuideBlogPost.post,
        featured_image_url:
          'https://cdn.ogabassey.com/media/blog/best-phones-cover.webp',
        featured_image_alt: 'Best phones in Nigeria cover',
      },
    });

    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    const image = screen.getByRole('img', {
      name: 'Best phones in Nigeria cover',
    });

    expect(image).toHaveAttribute(
      'src',
      'https://cdn.ogabassey.com/media/blog/best-phones-cover.webp'
    );
    // Repo LCP convention: preload XOR the loading/fetchPriority pair — never
    // the redundant trio the hero shipped with before. The focused shell and
    // preload-parity suites cover the non-DOM preload/quality inputs.
    expect(image).not.toHaveAttribute('priority');
    expect(image).not.toHaveAttribute('fetchpriority');
    expect(image).not.toHaveAttribute('loading');
  });

  it('permanently redirects retired direct blog slugs before rendering notFound', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue(null);
    mockGetLiveBlogPost.mockResolvedValue(null);
    mockGetBlogPostRedirect.mockResolvedValueOnce({
      merchant: {
        id: 'merchant-1',
        business_name: 'Ogabassey',
        slug: 'ogabassey',
        custom_domain: 'ogabassey.com',
      },
      targetSlug: 'canonical-post',
    });

    await expect(
      BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey.com',
          postSlug: 'retired-post',
        }),
      })
    ).rejects.toThrow(
      'NEXT_PERMANENT_REDIRECT:https://ogabassey.com/blog/canonical-post'
    );

    expect(mockGetBlogPostRedirect).toHaveBeenCalledWith(
      'ogabassey.com',
      'retired-post'
    );
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('renders stable noindex soft-not-found content for missing direct blog slugs without redirects', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue(null);
    mockGetLiveBlogPost.mockResolvedValue(null);
    mockGetBlogPostRedirect.mockResolvedValueOnce(null);

    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey.com',
          postSlug: 'retired-post',
        }),
      })
    );

    expect(mockGetBlogPostRedirect).toHaveBeenCalledWith(
      'ogabassey.com',
      'retired-post'
    );
    expect(
      screen.getByRole('heading', { name: 'Blog post not found' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to blog' })).toHaveAttribute(
      'href',
      '/blog'
    );
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('renders soft-not-found for over-encoded bot post slugs without any blog lookups', async () => {
    let overEncodedPostSlug = 'best phones in nigeria';
    for (let i = 0; i < 10; i++) {
      overEncodedPostSlug = encodeURIComponent(overEncodedPostSlug);
    }

    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey.com',
          postSlug: overEncodedPostSlug,
        }),
      })
    );

    expect(
      screen.getByRole('heading', { name: 'Blog post not found' })
    ).toBeInTheDocument();
    expect(mockGetRequestScopedBlogPost).not.toHaveBeenCalled();
    expect(mockGetLiveBlogPost).not.toHaveBeenCalled();
    expect(mockGetBlogPostRedirect).not.toHaveBeenCalled();
  });

  it('renders soft-not-found for extremely long post slugs without any blog lookups', async () => {
    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey.com',
          postSlug: 'a'.repeat(4000),
        }),
      })
    );

    expect(
      screen.getByRole('heading', { name: 'Blog post not found' })
    ).toBeInTheDocument();
    expect(mockGetRequestScopedBlogPost).not.toHaveBeenCalled();
    expect(mockGetLiveBlogPost).not.toHaveBeenCalled();
    expect(mockGetBlogPostRedirect).not.toHaveBeenCalled();
  });

  it('links missing merchant-slug blog posts back to the slug-scoped blog index', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue(null);
    mockGetLiveBlogPost.mockResolvedValue(null);
    mockGetBlogPostRedirect.mockResolvedValueOnce(null);

    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'my-store',
          postSlug: 'retired-post',
        }),
      })
    );

    expect(mockGetBlogPostRedirect).toHaveBeenCalledWith(
      'my-store',
      'retired-post'
    );
    expect(screen.getByRole('link', { name: 'Back to blog' })).toHaveAttribute(
      'href',
      '/my-store/blog'
    );
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('passes the author personal sameAs and headshot image to structured data', async () => {
    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    expect(mockGenerateBlogPostSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        author: expect.objectContaining({
          sameAs: ['https://www.linkedin.com/in/michael-bolakale'],
          image:
            'https://cdn.ogabassey.com/merchants/ogabassey/authors/bolakale.jpg',
        }),
      })
    );
  });

  it('passes known author hub URL and stable Person id to structured data', async () => {
    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    expect(mockGenerateBlogPostSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        author: expect.objectContaining({
          id: 'https://ogabassey.com#author-bolakale',
          url: 'https://ogabassey.com/blog/author/bolakale',
        }),
      })
    );
  });

  it('falls back to the store URL and omits byline href when no author hub exists', async () => {
    mockHasBlogAuthorPage.mockReturnValue(false);

    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    expect(mockGenerateBlogPostSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        author: expect.objectContaining({
          id: undefined,
          url: 'https://ogabassey.com',
        }),
      })
    );
    expect(mockBlogPostHeader).toHaveBeenCalledWith(
      expect.objectContaining({
        authorHref: undefined,
      })
    );
  });

  it('renders blog posts without an author name without trying to build an author slug', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...smartphoneGuideBlogPost,
      post: {
        ...smartphoneGuideBlogPost.post,
        author_name: null,
      },
    });

    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    expect(mockHasBlogAuthorPage).not.toHaveBeenCalled();
    expect(mockGenerateBlogPostSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        author: expect.objectContaining({
          name: 'Ogabassey',
          id: undefined,
          url: 'https://ogabassey.com',
        }),
      })
    );
    expect(mockBlogPostHeader).toHaveBeenCalledWith(
      expect.objectContaining({
        authorHref: undefined,
        author_name: null,
      })
    );
  });

  it('links the byline to the author page for a known author', async () => {
    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    expect(mockBlogPostHeader).toHaveBeenCalledWith(
      expect.objectContaining({
        authorHref: '/ogabassey/blog/author/bolakale',
      })
    );
  });
});
