import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlogPostBody } from './BlogPostBody';

const { mockGetCachedDeadContentLinkSlugs, mockResolveBlogPostContent } =
  vi.hoisted(() => ({
    mockGetCachedDeadContentLinkSlugs: vi.fn(),
    mockResolveBlogPostContent: vi.fn(),
  }));

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({
    alt,
    fill: _fill,
    src,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    alt: string;
    fill?: boolean;
    src: string;
    // biome-ignore lint/performance/noImgElement: test mock for next/image
  }) => <img alt={alt} src={src} {...props} />,
}));

vi.mock('@/components/blog/table-of-contents', () => ({
  TableOfContents: () => <nav aria-label="Table of contents">TOC</nav>,
}));

vi.mock('@/components/blog/renderer/BlogContentRenderer', () => ({
  BlogContentRenderer: ({ json }: { json: unknown }) => (
    <div data-testid="blog-json-renderer">{JSON.stringify(json)}</div>
  ),
}));

vi.mock('./blog-post-content', async () => {
  const actual = await vi.importActual('./blog-post-content');
  return {
    ...actual,
    resolveBlogPostContent: mockResolveBlogPostContent,
  };
});

vi.mock('@/lib/cached-dead-content-links', () => ({
  getCachedDeadContentLinkSlugs: mockGetCachedDeadContentLinkSlugs,
}));
vi.mock('@/lib/cached-content-link-rewrites', () => ({
  getCachedContentLinkRewrites: vi
    .fn()
    .mockResolvedValue({ blogSlugs: {}, productPaths: {} }),
}));

describe('BlogPostBody', () => {
  afterEach(() => {
    mockGetCachedDeadContentLinkSlugs.mockReset();
    mockResolveBlogPostContent.mockReset();
  });

  it('renders the structured JSON branch with tags and related posts', async () => {
    const content = { type: 'doc', content: [] };
    mockResolveBlogPostContent.mockResolvedValue({
      isJson: true,
      legacyHtml: '',
      renderedContent: { type: 'doc', content: [] },
    });

    render(
      await BlogPostBody({
        basePath: '/ogabassey',
        baseUrl: 'https://usebaci.com',
        content,
        merchantSlug: 'ogabassey',
        post: {
          id: 'post-1',
          slug: 'pixel-9-review',
          tags: ['Android', 'Google'],
          title: 'Pixel 9 Review',
        },
        relatedProducts: [],
        relatedPosts: [
          {
            id: 'related-1',
            slug: 'related-post',
            title: 'Related Post',
            category: 'Guides',
            featured_image_url: 'https://example.com/related.jpg',
            published_at: '2026-03-01T00:00:00.000Z',
            reading_time_minutes: 4,
          },
        ],
      })
    );

    expect(
      screen.getByRole('navigation', { name: /table of contents/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId('blog-json-renderer')).toBeInTheDocument();
    expect(screen.getByText('Android')).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(mockResolveBlogPostContent).toHaveBeenCalledWith(content, {
      catalogPrices: { products: [], currencySource: undefined },
      basePath: '/ogabassey',
      baseUrl: 'https://usebaci.com',
      fallbackImageAlt: 'Pixel 9 Review',
      hasPreloadedHeroImage: true,
      merchantSlug: 'ogabassey',
    });
    expect(
      screen.getByRole('link', { name: /Related Post/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Related Post' })
    ).toBeInTheDocument();
    expect(screen.getByText('4 min read')).toBeInTheDocument();
  });

  it('renders the legacy HTML branch and encodes share urls', async () => {
    mockResolveBlogPostContent.mockResolvedValue({
      isJson: false,
      legacyHtml:
        '<figure><img src="https://cdn.example.com/photo.jpg" alt="Legacy image"><figcaption>Legacy caption</figcaption></figure>',
      renderedContent: null,
    });

    render(
      await BlogPostBody({
        basePath: '/ogabassey',
        baseUrl: 'https://usebaci.com',
        content: '<p>Legacy HTML body</p>',
        merchantSlug: 'ogabassey',
        postUrl: 'https://usebaci.com/ogabassey/blog/pixel-9-review',
        post: {
          id: 'post-1',
          slug: 'pixel-9-review',
          tags: null,
          title: 'Pixel 9 Review',
        },
        relatedProducts: [],
        relatedPosts: [],
      })
    );

    expect(screen.getByTestId('blog-post-legacy-content').innerHTML).toContain(
      'Legacy caption'
    );

    const encodedTitle = encodeURIComponent('Pixel 9 Review');
    const encodedShareUrl = encodeURIComponent(
      'https://usebaci.com/ogabassey/blog/pixel-9-review'
    );

    expect(screen.getByRole('link', { name: 'Twitter' })).toHaveAttribute(
      'href',
      expect.stringContaining(encodedShareUrl)
    );
    expect(screen.getByRole('link', { name: 'Twitter' })).toHaveAttribute(
      'href',
      expect.stringContaining(encodedTitle)
    );
    expect(screen.getByRole('link', { name: 'LinkedIn' })).toHaveAttribute(
      'href',
      expect.stringContaining(encodedShareUrl)
    );
    expect(screen.getByRole('link', { name: 'Facebook' })).toHaveAttribute(
      'href',
      expect.stringContaining(encodedShareUrl)
    );
    expect(mockResolveBlogPostContent).toHaveBeenCalledWith(
      '<p>Legacy HTML body</p>',
      {
        catalogPrices: { products: [], currencySource: undefined },
        basePath: '/ogabassey',
        baseUrl: 'https://usebaci.com',
        fallbackImageAlt: 'Pixel 9 Review',
        hasPreloadedHeroImage: true,
        merchantSlug: 'ogabassey',
      }
    );
  });

  it('normalizes legacy HTML heading hierarchy inside the article body', async () => {
    mockResolveBlogPostContent.mockResolvedValue({
      isJson: false,
      legacyHtml:
        '<h1>Imported Article Title</h1><h2>Imported Section</h2><p>Source: <a href="https://example.com/specs.json">Product data JSON</a></p>',
      renderedContent: null,
    });

    render(
      await BlogPostBody({
        basePath: '/ogabassey',
        baseUrl: 'https://usebaci.com',
        content: '<h1>Imported Article Title</h1>',
        merchantSlug: 'ogabassey',
        post: {
          id: 'post-1',
          slug: 'pixel-9-review',
          tags: null,
          title: 'Pixel 9 Review',
        },
        relatedProducts: [],
        relatedPosts: [],
      })
    );

    const legacyContent = screen.getByTestId('blog-post-legacy-content');

    expect(legacyContent.querySelector('h1')).toBeNull();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Imported Article Title',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Imported Section' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Product data JSON' })
    ).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('uses canonical postUrl for subdomain share links without doubled slug', async () => {
    mockResolveBlogPostContent.mockResolvedValue({
      isJson: false,
      legacyHtml: '<p>Content</p>',
      renderedContent: null,
    });

    render(
      await BlogPostBody({
        basePath: '/ogabassey',
        baseUrl: 'https://ogabassey.usebaci.com',
        content: '<p>Content</p>',
        merchantSlug: 'ogabassey',
        postUrl: 'https://ogabassey.usebaci.com/blog/my-post',
        post: {
          id: 'post-1',
          slug: 'my-post',
          tags: null,
          title: 'My Post',
        },
        relatedProducts: [],
        relatedPosts: [],
      })
    );

    // Share URL should be the canonical subdomain URL, NOT doubled like
    // https://ogabassey.usebaci.com/ogabassey/blog/my-post
    const expectedShareUrl = encodeURIComponent(
      'https://ogabassey.usebaci.com/blog/my-post'
    );

    expect(screen.getByRole('link', { name: 'Twitter' })).toHaveAttribute(
      'href',
      expect.stringContaining(expectedShareUrl)
    );
  });

  it('renders a lazy video panel when video metadata is provided', async () => {
    mockResolveBlogPostContent.mockResolvedValue({
      isJson: false,
      legacyHtml: '<p>Content</p>',
      renderedContent: null,
    });

    render(
      await BlogPostBody({
        basePath: '/ogabassey',
        baseUrl: 'https://usebaci.com',
        content: '<p>Content</p>',
        merchantSlug: 'ogabassey',
        post: {
          id: 'post-1',
          slug: 'my-post',
          tags: null,
          title: 'My Post',
        },
        relatedProducts: [],
        relatedPosts: [],
        video: {
          thumbnailUrl: 'https://i.ytimg.com/vi/tp-AlU5FVpE/hqdefault.jpg',
          title: 'Pixel 9 Pro Fold Unboxing',
          videoId: 'tp-AlU5FVpE',
          watchUrl: 'https://www.youtube.com/watch?v=tp-AlU5FVpE',
        },
      })
    );

    expect(
      screen.getByRole('heading', { name: /watch the related video/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: 'Video thumbnail for Pixel 9 Pro Fold Unboxing',
      })
    ).toHaveAttribute(
      'src',
      'https://i.ytimg.com/vi/tp-AlU5FVpE/hqdefault.jpg'
    );
    expect(
      screen.getByRole('link', {
        name: /open video on youtube: pixel 9 pro fold/i,
      })
    ).toHaveAttribute('href', 'https://www.youtube.com/watch?v=tp-AlU5FVpE');
    expect(screen.queryByTitle('Pixel 9 Pro Fold Unboxing')).toBeNull();
  });

  it('renders related product links using category-aware and fallback product routes', async () => {
    mockResolveBlogPostContent.mockResolvedValue({
      isJson: false,
      legacyHtml: '<p>Content</p>',
      renderedContent: null,
    });

    render(
      await BlogPostBody({
        basePath: '/ogabassey',
        baseUrl: 'https://usebaci.com',
        content: '<p>Content</p>',
        merchantSlug: 'ogabassey',
        post: {
          id: 'post-1',
          slug: 'my-post',
          tags: null,
          title: 'My Post',
        },
        relatedProducts: [
          {
            id: 'product-1',
            name: 'iPhone 16',
            slug: 'iphone-16',
            category_slug: 'smartphones',
          },
          {
            id: 'product-2',
            name: 'DualSense Wireless Controller',
            slug: 'ps5-dualsense-wireless-controller',
          },
        ],
        relatedPosts: [],
      })
    );

    expect(
      screen.getByRole('heading', { name: /popular products mentioned/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'iPhone 16' })).toHaveAttribute(
      'href',
      '/ogabassey/smartphones/iphone-16'
    );
    expect(
      screen.getByRole('link', { name: 'DualSense Wireless Controller' })
    ).toHaveAttribute(
      'href',
      '/ogabassey/products/ps5-dualsense-wireless-controller'
    );
  });

  it('trims related product names and slugs before building routes', async () => {
    mockResolveBlogPostContent.mockResolvedValue({
      isJson: false,
      legacyHtml: '<p>Content</p>',
      renderedContent: null,
    });

    render(
      await BlogPostBody({
        basePath: '/ogabassey',
        baseUrl: 'https://usebaci.com',
        content: '<p>Content</p>',
        merchantSlug: 'ogabassey',
        post: {
          id: 'post-1',
          slug: 'my-post',
          tags: null,
          title: 'My Post',
        },
        relatedProducts: [
          {
            id: 'product-1',
            name: '  iPhone 16  ',
            slug: '  iphone-16  ',
            category_slug: '  smartphones  ',
          },
          {
            id: 'product-2',
            name: '  PS5 Controller  ',
            slug: '  ps5-controller  ',
            category_slug: null,
          },
        ],
        relatedPosts: [],
      })
    );

    const productLink = screen.getByRole('link', { name: 'iPhone 16' });
    expect(productLink).toHaveAttribute(
      'href',
      '/ogabassey/smartphones/iphone-16'
    );
    expect(productLink).toHaveTextContent(/^iPhone 16$/);
    const fallbackProductLink = screen.getByRole('link', {
      name: 'PS5 Controller',
    });
    expect(fallbackProductLink).toHaveAttribute(
      'href',
      '/ogabassey/products/ps5-controller'
    );
    expect(fallbackProductLink).toHaveTextContent(/^PS5 Controller$/);
  });

  it('builds category-aware product links preserving stored category_slug', async () => {
    mockResolveBlogPostContent.mockResolvedValue({
      isJson: false,
      legacyHtml: '<p>Content</p>',
      renderedContent: null,
    });

    render(
      await BlogPostBody({
        basePath: '/ogabassey',
        baseUrl: 'https://usebaci.com',
        content: '<p>Content</p>',
        merchantSlug: 'ogabassey',
        post: {
          id: 'post-1',
          slug: 'my-post',
          tags: null,
          title: 'My Post',
        },
        relatedProducts: [
          {
            id: 'product-1',
            name: 'iPhone 16',
            slug: 'iphone-16',
            // category_slug is used as-is — alias remapping happens at the
            // storefront route level via 301 redirects
            category_slug: 'phones',
          },
          {
            id: 'product-2',
            name: 'MacBook Air M4',
            slug: 'macbook-air-m4',
            // Merchant-defined slug — not an alias, preserved as-is
            category_slug: 'macbook',
          },
        ],
        relatedPosts: [],
      })
    );

    expect(screen.getByRole('link', { name: 'iPhone 16' })).toHaveAttribute(
      'href',
      '/ogabassey/phones/iphone-16'
    );
    expect(
      screen.getByRole('link', { name: 'MacBook Air M4' })
    ).toHaveAttribute('href', '/ogabassey/macbook/macbook-air-m4');
  });

  it('skips malformed related products so the section degrades gracefully', async () => {
    mockResolveBlogPostContent.mockResolvedValue({
      isJson: false,
      legacyHtml: '<p>Content</p>',
      renderedContent: null,
    });

    render(
      await BlogPostBody({
        basePath: '/ogabassey',
        baseUrl: 'https://usebaci.com',
        content: '<p>Content</p>',
        merchantSlug: 'ogabassey',
        post: {
          id: 'post-1',
          slug: 'my-post',
          tags: null,
          title: 'My Post',
        },
        relatedProducts: [
          {
            id: 'product-1',
            name: '',
            slug: '',
          },
        ],
        relatedPosts: [],
      })
    );

    expect(
      screen.queryByRole('heading', { name: /popular products mentioned/i })
    ).not.toBeInTheDocument();
  });

  describe('dead content link unwrapping', () => {
    it('does not attempt dead-link resolution when merchantId is not provided', async () => {
      mockResolveBlogPostContent.mockResolvedValue({
        isJson: false,
        legacyHtml: '<p><a href="/blog/draft-post">Draft Post</a></p>',
        renderedContent: null,
      });

      render(
        await BlogPostBody({
          basePath: '/ogabassey',
          baseUrl: 'https://usebaci.com',
          content: '<p><a href="/blog/draft-post">Draft Post</a></p>',
          merchantSlug: 'ogabassey',
          post: {
            id: 'post-1',
            slug: 'my-post',
            tags: null,
            title: 'My Post',
          },
          relatedProducts: [],
          relatedPosts: [],
        })
      );

      expect(mockGetCachedDeadContentLinkSlugs).not.toHaveBeenCalled();
      expect(
        screen.getByRole('link', { name: 'Draft Post' })
      ).toBeInTheDocument();
    });

    it('unwraps a dead /blog/x link in legacy HTML content while keeping live links', async () => {
      const actual = await vi.importActual<
        typeof import('./blog-post-content')
      >('./blog-post-content');
      mockResolveBlogPostContent.mockImplementation(
        actual.resolveBlogPostContent
      );
      mockGetCachedDeadContentLinkSlugs.mockResolvedValue({
        blog: ['draft-post'],
        products: [],
      });

      render(
        await BlogPostBody({
          basePath: '/ogabassey',
          baseUrl: 'https://usebaci.com',
          content:
            '<p><a href="/blog/draft-post">Draft Post</a> <a href="/blog/live-post">Live Post</a></p>',
          merchantId: 'merchant-1',
          merchantSlug: 'ogabassey',
          post: {
            id: 'post-1',
            slug: 'my-post',
            tags: null,
            title: 'My Post',
          },
          relatedProducts: [],
          relatedPosts: [],
        })
      );

      expect(mockGetCachedDeadContentLinkSlugs).toHaveBeenCalledWith(
        'merchant-1',
        ['draft-post', 'live-post'],
        []
      );
      expect(
        screen.queryByRole('link', { name: 'Draft Post' })
      ).not.toBeInTheDocument();
      expect(screen.getByText('Draft Post')).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Live Post' })
      ).toBeInTheDocument();
    });

    it('fails open (keeps all links) when the dead-content-link loader rejects', async () => {
      const actual = await vi.importActual<
        typeof import('./blog-post-content')
      >('./blog-post-content');
      mockResolveBlogPostContent.mockImplementation(
        actual.resolveBlogPostContent
      );
      mockGetCachedDeadContentLinkSlugs.mockRejectedValue(
        new Error('cache backend down')
      );
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      render(
        await BlogPostBody({
          basePath: '/ogabassey',
          baseUrl: 'https://usebaci.com',
          content: '<p><a href="/blog/draft-post">Draft Post</a></p>',
          merchantId: 'merchant-1',
          merchantSlug: 'ogabassey',
          post: {
            id: 'post-1',
            slug: 'my-post',
            tags: null,
            title: 'My Post',
          },
          relatedProducts: [],
          relatedPosts: [],
        })
      );

      expect(
        screen.getByRole('link', { name: 'Draft Post' })
      ).toBeInTheDocument();

      consoleErrorSpy.mockRestore();
    });
  });
});
