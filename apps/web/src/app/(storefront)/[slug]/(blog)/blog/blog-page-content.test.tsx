import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildListingResult,
  type MockDefaultBlogUiProps,
  merchant,
  mockDefaultBlogUi,
  mockGetCachedBlogListing,
  mockGetTemplate,
  mockNotFound,
  mockTemplateBlogRenderer,
  resetBlogPageContentMocks,
} from './blog-page-content.test-utils';

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
});
