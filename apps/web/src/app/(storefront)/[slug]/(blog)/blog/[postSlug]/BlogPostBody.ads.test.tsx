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
  BlogContentRenderer: ({
    inArticleAdSlot,
    json,
  }: {
    inArticleAdSlot?: ReactNode;
    json: unknown;
  }) => (
    <div data-testid="blog-json-renderer">
      {JSON.stringify(json)}
      {inArticleAdSlot}
    </div>
  ),
}));

vi.mock(
  '@/components/storefront/ogabassey/components/deferred-ad-unit',
  () => ({
    DeferredAdUnit: ({
      placementKey,
      slotInstance,
    }: {
      placementKey: string;
      slotInstance?: string;
    }) => (
      <div
        data-placement={placementKey}
        data-slot-instance={slotInstance}
        data-testid="blog-deferred-ad-unit"
      />
    ),
  })
);

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

describe('BlogPostBody Ogabassey article ad placements', () => {
  afterEach(() => {
    mockGetCachedDeadContentLinkSlugs.mockReset();
    mockResolveBlogPostContent.mockReset();
  });

  it('renders sticky rail, mid-article, and post-prose ads on Ogabassey blog posts', async () => {
    mockResolveBlogPostContent.mockResolvedValue({
      isJson: true,
      legacyHtml: '',
      renderedContent: { type: 'doc', content: [] },
    });

    render(
      await BlogPostBody({
        basePath: '/ogabassey',
        baseUrl: 'https://ogabassey.com',
        content: { type: 'doc', content: [] },
        merchantSlug: 'ogabassey',
        post: {
          id: 'post-99',
          slug: 'iphone-17-vs-s26',
          tags: null,
          title: 'iPhone 17 vs Galaxy S26',
        },
        relatedProducts: [],
        relatedPosts: [],
      })
    );

    const adUnits = screen.getAllByTestId('blog-deferred-ad-unit');
    expect(adUnits.map((unit) => unit.getAttribute('data-placement'))).toEqual([
      'BLOG_SIDEBAR',
      'BLOG_SIDEBAR',
      'SIDEBAR_HALF_PAGE',
    ]);
    const sidebarRail = screen.getByRole('complementary', {
      name: /sponsored sidebar/i,
    });
    expect(sidebarRail).toHaveClass('w-[300px]', 'lg:block');
    expect(sidebarRail.parentElement).toHaveClass(
      'lg:grid-cols-[minmax(0,1fr)_300px]'
    );
  });

  it('never injects Ogabassey GAM ad units into third-party merchant blog posts', async () => {
    mockResolveBlogPostContent.mockResolvedValue({
      isJson: true,
      legacyHtml: '',
      renderedContent: { type: 'doc', content: [] },
    });

    render(
      await BlogPostBody({
        basePath: '/other-merchant',
        baseUrl: 'https://othermerchant.com',
        content: { type: 'doc', content: [] },
        merchantSlug: 'other-merchant',
        post: {
          id: 'post-100',
          slug: 'welcome-post',
          tags: null,
          title: 'Welcome Post',
        },
        relatedProducts: [],
        relatedPosts: [],
      })
    );

    expect(
      screen.queryByTestId('blog-deferred-ad-unit')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('complementary', { name: /sponsored sidebar/i })
    ).not.toBeInTheDocument();
  });
});
