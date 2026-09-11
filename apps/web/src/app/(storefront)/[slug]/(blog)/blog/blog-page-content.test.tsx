import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildListingResult,
  clusterCollections,
  type MockDefaultBlogUiProps,
  merchant,
  mockBuildBlogClusterCollections,
  mockDefaultBlogUi,
  mockGetCachedBlogListing,
  mockGetTemplate,
  mockHeaders,
  mockNotFound,
  mockPermanentRedirect,
  mockPreloadBlogListingFeaturedImage,
  mockRedirect,
  mockTemplateBlogRenderer,
  postsPayload,
  resetBlogPageContentMocks,
} from './blog-page-content.test-utils';
import { ogabasseyBlogLcpSnapshot } from './ogabassey-blog-lcp-snapshot';

const { BlogPageContent } = await import('./blog-page-content');

function joinTemplateProbeHref(basePath: string, path: string): string {
  if (path.startsWith('https://') || path.startsWith('http://')) {
    return path;
  }

  if (basePath.startsWith('https://') || basePath.startsWith('http://')) {
    const normalizedBaseUrl = basePath.trim().replace(/\/+$/g, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBaseUrl}${normalizedPath}`;
  }

  const normalizedBasePath = basePath.trim().replace(/\/+$/g, '');
  const routeBasePath = normalizedBasePath
    ? normalizedBasePath.startsWith('/')
      ? normalizedBasePath
      : `/${normalizedBasePath}`
    : '';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${routeBasePath}${normalizedPath}`;
}

function TemplateLinkProbe({
  posts = [],
  storeSlug = '',
}: {
  posts?: Array<{ slug: string; title: string }>;
  storeSlug?: string;
}) {
  const post = posts[0];
  if (!post) {
    return <div>No post</div>;
  }

  return (
    <a
      aria-label={`Template ${post.title}`}
      href={joinTemplateProbeHref(storeSlug, `/blog/${post.slug}`)}
    >
      {post.title}
    </a>
  );
}

function renderTemplateRendererProbe() {
  mockTemplateBlogRenderer.mockImplementationOnce((props) => {
    const BlogComponent = props.BlogComponent;
    if (!BlogComponent) {
      return <div>No template component</div>;
    }

    return (
      <>
        <BlogComponent
          categories={props.categories}
          category={props.category}
          hideFeaturedStory={props.hideFeaturedStory}
          posts={props.blogPosts}
          searchQuery={props.searchQuery}
          storeSlug={props.basePath}
        />
        {props.categoryGuide}
      </>
    );
  });
}

describe('BlogPageContent', () => {
  beforeEach(() => {
    resetBlogPageContentMocks();
  });

  it('throws not found when the listing data is missing at render time', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(null);

    await expect(
      BlogPageContent({
        params: Promise.resolve({ slug: 'missing-store' }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledOnce();
  });

  it('throws not found for over-encoded bot category filters before the listing lookup', async () => {
    let overEncodedCategory = 'some phrase';
    for (let i = 0; i < 10; i++) {
      overEncodedCategory = encodeURIComponent(overEncodedCategory);
    }

    await expect(
      BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ category: overEncodedCategory }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledOnce();
    expect(mockGetCachedBlogListing).not.toHaveBeenCalled();
  });

  it('clamps an extremely long search filter instead of 404ing, and still runs the lookup', async () => {
    await BlogPageContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({ search: 'a'.repeat(4000) }),
    });

    // Search is free-form text, not a slug: it must not 404. The cached lookup
    // receives the query clamped to a bounded length (unbounded key avoided).
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(mockGetCachedBlogListing).toHaveBeenCalledWith(
      'ogabassey',
      expect.objectContaining({ searchQuery: 'a'.repeat(100) })
    );
  });

  it('renders crawlable blog links in the route HTML instead of a Suspense shell', async () => {
    mockDefaultBlogUi.mockImplementation((props: MockDefaultBlogUiProps) => (
      <section>
        <h1>{props.merchant.business_name} blog</h1>
        {props.posts.map((post) => (
          <a key={post.slug} href={`/blog/${post.slug}`}>
            {post.title}
          </a>
        ))}
      </section>
    ));

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(
      screen.queryByRole('status', { name: /loading blog posts/i })
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'First Post' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: expect.stringContaining('/blog/first-post'),
        }),
      ])
    );
  });

  it('preloads the root listing featured image before rendering the blog UI', async () => {
    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(mockPreloadBlogListingFeaturedImage).toHaveBeenCalledWith(
      'https://cdn.example.com/blog-cover.png'
    );
  });

  it('does not preload a featured listing image when the live story matches the committed snapshot', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        posts: [
          {
            ...postsPayload[0],
            slug: ogabasseyBlogLcpSnapshot.featuredPost.slug,
          },
        ],
      })
    );

    render(
      await BlogPageContent({
        hideFeaturedStory: true,
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(mockPreloadBlogListingFeaturedImage).not.toHaveBeenCalled();
  });

  it('does not preload a live featured image when the snapshot hero is committed', async () => {
    render(
      await BlogPageContent({
        hideFeaturedStory: true,
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(mockPreloadBlogListingFeaturedImage).not.toHaveBeenCalled();
    expect(document.querySelector('[data-blog-live-featured]')).toBeNull();
  });

  it('preloads the same first listing image used by the OgaBassey hero story', async () => {
    const firstPost = {
      ...postsPayload[0],
      id: 'post-first',
      title: 'First Post',
      slug: 'first-post',
      featured_image_url: 'https://cdn.example.com/first.png',
    };
    const secondPost = {
      ...postsPayload[0],
      id: 'post-second',
      title: 'Second Post',
      slug: 'second-post',
      featured_image_url: 'https://cdn.example.com/second.png',
    };
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        posts: [firstPost, secondPost],
      })
    );
    mockGetTemplate.mockReturnValueOnce({
      getComponents: async () => ({
        Blog: () => <div>OgaBassey blog component</div>,
      }),
    });

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(mockPreloadBlogListingFeaturedImage).toHaveBeenCalledWith(
      'https://cdn.example.com/first.png'
    );
    expect(mockTemplateBlogRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        blogPosts: expect.arrayContaining([
          expect.objectContaining({
            slug: 'first-post',
          }),
        ]),
      })
    );
  });

  it('renders template blog links with canonical absolute storefront URLs', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          slug: 'ogabassey',
        },
      })
    );
    mockGetTemplate.mockReturnValueOnce({
      getComponents: async () => ({
        Blog: TemplateLinkProbe,
      }),
    });
    renderTemplateRendererProbe();

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(
      screen.getByRole('link', { name: 'Template First Post' })
    ).toHaveAttribute('href', 'https://ogabassey.usebaci.com/blog/first-post');
  });

  it('renders template blog links with canonical path-prefixed storefront URLs', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          slug: 'ogabassey',
          store_url: 'http://localhost:3000/ogabassey',
        },
      })
    );
    mockGetTemplate.mockReturnValueOnce({
      getComponents: async () => ({
        Blog: TemplateLinkProbe,
      }),
    });
    renderTemplateRendererProbe();

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(
      screen.getByRole('link', { name: 'Template First Post' })
    ).toHaveAttribute(
      'href',
      'http://localhost:3000/ogabassey/blog/first-post'
    );
  });

  it('passes crawlable category guide copy through the Ogabassey template blog path', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          custom_domain: 'ogabassey.com',
          slug: 'ogabassey',
          template_id: 'ogabassey',
        },
        totalPosts: 6,
      })
    );
    mockGetTemplate.mockReturnValueOnce({
      getComponents: async () => ({
        Blog: TemplateLinkProbe,
      }),
    });
    renderTemplateRendererProbe();

    render(
      await BlogPageContent({
        categoryOverride: 'Reviews',
        isCleanCategoryRoute: true,
        itemListSchemaUrl: 'https://ogabassey.com/blog/category/reviews',
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(
      screen.getByRole('heading', {
        name: 'How to use Ogabassey review articles',
      })
    ).toBeInTheDocument();
    expect(mockTemplateBlogRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'Reviews',
        categoryGuide: expect.anything(),
      })
    );
  });

  it('does not preload a template-specific hero image for non-Ogabassey templates', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          template_id: 'modern',
        },
      })
    );
    mockGetTemplate.mockReturnValueOnce({
      getComponents: async () => ({
        Blog: () => <div>Custom blog component</div>,
      }),
    });

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(screen.getByText('Template blog')).toBeInTheDocument();
    expect(mockPreloadBlogListingFeaturedImage).not.toHaveBeenCalled();
  });

  it('does not preload a featured image for filtered listings without a hero story', async () => {
    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ category: 'News', search: 'iphone' }),
      })
    );

    expect(mockPreloadBlogListingFeaturedImage).not.toHaveBeenCalled();
  });

  it('renders guide collections after the blog listing', async () => {
    mockBuildBlogClusterCollections.mockReturnValue(clusterCollections);

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(
      screen.getByRole('heading', { name: /guide collections/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Best Phones in Nigeria' })
    ).toHaveAttribute(
      'href',
      'https://ogabassey.com/blog/best-phones-in-nigeria'
    );
    const blogListing = screen.getByText('Ogabassey blog');
    const guideCollections = screen.getByRole('heading', {
      name: /guide collections/i,
    });
    const discoveryLinks = screen.getByRole('heading', {
      name: /continue exploring/i,
    });
    expect(
      blogListing.compareDocumentPosition(guideCollections) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      guideCollections.compareDocumentPosition(discoveryLinks) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('redirects out-of-range paginated listings to the last real page', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          slug: 'ogabassey',
        },
        totalPosts: 50,
        posts: [],
      })
    );

    await expect(
      BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ page: '999', category: 'Guides' }),
      })
    ).rejects.toThrow(
      'NEXT_REDIRECT:https://ogabassey.usebaci.com/blog?category=Guides&page=5'
    );

    expect(mockRedirect).toHaveBeenCalledWith(
      'https://ogabassey.usebaci.com/blog?category=Guides&page=5'
    );
  });

  it('permanently redirects category-only query listings to the clean category hub', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          slug: 'ogabassey',
          custom_domain: 'ogabassey.com',
        },
        totalPosts: 10,
      })
    );

    await expect(
      BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        searchParams: Promise.resolve({ category: 'News' }),
      })
    ).rejects.toThrow(
      'NEXT_PERMANENT_REDIRECT:https://ogabassey.com/blog/category/news'
    );

    expect(mockPermanentRedirect).toHaveBeenCalledWith(
      'https://ogabassey.com/blog/category/news'
    );
  });

  it('uses a clean-route category override without needing category in search params', async () => {
    render(
      await BlogPageContent({
        categoryOverride: 'Smartphones',
        isCleanCategoryRoute: true,
        itemListSchemaUrl:
          'https://test-store.usebaci.com/blog/category/smartphones',
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(mockGetCachedBlogListing).toHaveBeenCalledWith('test-store', {
      category: 'Smartphones',
      page: 1,
      searchQuery: undefined,
    });
    expect(mockPermanentRedirect).not.toHaveBeenCalled();
  });

  it('permanently redirects slug-form category query values to the matching clean category hub', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce({
      ...buildListingResult({
        merchant: {
          ...merchant,
          slug: 'ogabassey',
          custom_domain: 'ogabassey.com',
        },
        totalPosts: 10,
      }),
      categories: ['Buying Guides'],
    });

    await expect(
      BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        searchParams: Promise.resolve({ category: 'buying-guides' }),
      })
    ).rejects.toThrow(
      'NEXT_PERMANENT_REDIRECT:https://ogabassey.com/blog/category/buying-guides'
    );

    expect(mockPermanentRedirect).toHaveBeenCalledWith(
      'https://ogabassey.com/blog/category/buying-guides'
    );
  });

  it('permanently redirects repeated category query values without throwing', async () => {
    await expect(
      BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ category: ['News', 'Updates'] }),
      })
    ).rejects.toThrow(
      'NEXT_PERMANENT_REDIRECT:https://test-store.usebaci.com/blog/category/news'
    );

    expect(mockGetCachedBlogListing).toHaveBeenCalledWith('ogabassey', {
      category: 'News',
      page: 1,
      searchQuery: undefined,
    });
  });

  it('preserves additional query parameters when redirecting category-only listings', async () => {
    await expect(
      BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({
          category: 'News',
          utm_source: 'newsletter',
          utm_medium: ['email', 'sms'],
        }),
      })
    ).rejects.toThrow(
      'NEXT_PERMANENT_REDIRECT:https://test-store.usebaci.com/blog/category/news?utm_source=newsletter&utm_medium=email&utm_medium=sms'
    );

    expect(mockPermanentRedirect).toHaveBeenCalledWith(
      'https://test-store.usebaci.com/blog/category/news?utm_source=newsletter&utm_medium=email&utm_medium=sms'
    );
  });

  it('keeps searched category query listings on the noindex query route', async () => {
    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ category: 'News', search: 'iphone' }),
      })
    );

    expect(mockPermanentRedirect).not.toHaveBeenCalled();
    expect(mockDefaultBlogUi).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'News',
        searchQuery: 'iphone',
      })
    );
  });

  it('keeps category query listings when the clean category slug is reserved', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce({
      ...buildListingResult(),
      categories: ['Product'],
    });

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ category: 'Product' }),
      })
    );

    expect(mockPermanentRedirect).not.toHaveBeenCalled();
    expect(mockDefaultBlogUi).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'Product',
      })
    );
  });

  it('renders real prev/next head links for paginated listings', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          custom_domain: 'example.com',
        },
        totalPosts: 50,
      })
    );

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'example.com' }),
        searchParams: Promise.resolve({ page: '2', category: 'Guides' }),
      })
    );

    expect(document.head.querySelector('link[rel="prev"]')).toHaveAttribute(
      'href',
      'https://example.com/blog?category=Guides'
    );
    expect(document.head.querySelector('link[rel="next"]')).toHaveAttribute(
      'href',
      'https://example.com/blog?category=Guides&page=3'
    );
  });

  it('uses the provided canonical URL for ItemList schema URLs', async () => {
    render(
      await BlogPageContent({
        itemListSchemaUrl: 'https://example.com/blog/category/smartphones',
        params: Promise.resolve({ slug: 'example.com' }),
        searchParams: Promise.resolve({ category: 'Smartphones' }),
      })
    );

    expect(mockDefaultBlogUi).toHaveBeenCalledWith(
      expect.objectContaining({
        itemListSchema: expect.objectContaining({
          url: 'https://example.com/blog/category/smartphones',
        }),
      })
    );
  });

  it('uses canonical storefront links without reading request headers for non-domain listings', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          slug: 'ogabassey',
        },
        totalPosts: 50,
      })
    );

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ page: '2' }),
      })
    );

    expect(mockHeaders).not.toHaveBeenCalled();
    expect(mockDefaultBlogUi).toHaveBeenCalledWith(
      expect.objectContaining({
        basePath: 'https://ogabassey.usebaci.com',
        currentPage: 2,
        totalPosts: 50,
      })
    );
  });

  it('does not read request headers for custom-domain blog listings', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          slug: 'ogabassey',
          custom_domain: 'example.com',
        },
      })
    );

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'example.com' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(mockHeaders).not.toHaveBeenCalled();
    expect(mockDefaultBlogUi).toHaveBeenCalledWith(
      expect.objectContaining({
        basePath: 'https://example.com',
      })
    );
  });

  it('preserves path-prefixed storefront origins in prev/next head links', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          store_url: 'http://localhost:3000/ogabassey',
        },
        totalPosts: 50,
      })
    );

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ page: '2' }),
      })
    );

    expect(document.head.querySelector('link[rel="prev"]')).toHaveAttribute(
      'href',
      'http://localhost:3000/ogabassey/blog'
    );
    expect(document.head.querySelector('link[rel="next"]')).toHaveAttribute(
      'href',
      'http://localhost:3000/ogabassey/blog?page=3'
    );
  });

  it('uses structured image variants and preserves listing pagination totals', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        totalPosts: 50,
      })
    );

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(mockDefaultBlogUi).toHaveBeenCalledWith(
      expect.objectContaining({
        categories: ['News'],
        posts: [postsPayload[0]],
        totalPosts: 50,
      })
    );
    expect(mockDefaultBlogUi.mock.calls[0]?.[0].blogSchema.blogPost).toEqual([
      expect.objectContaining({
        image: [
          'https://cdn.example.com/blog-cover-16x9.png',
          'https://cdn.example.com/blog-cover-4x3.png',
          'https://cdn.example.com/blog-cover-1x1.png',
        ],
      }),
    ]);
    expect(mockDefaultBlogUi.mock.calls[0]?.[0].blogSchema.publisher).toEqual(
      expect.objectContaining({
        '@id': 'https://test-store.usebaci.com#organization',
      })
    );
  });
});
