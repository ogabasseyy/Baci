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

describe('BlogPostBody legacy rendering', () => {
  afterEach(() => {
    mockGetCachedDeadContentLinkSlugs.mockReset();
    mockResolveBlogPostContent.mockReset();
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
    expect(
      screen.getByTestId('blog-post-legacy-content').className
    ).not.toMatch(/\[&_a\]:text-/);

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
        basePath: '/ogabassey',
        baseUrl: 'https://usebaci.com',
        fallbackImageAlt: 'Pixel 9 Review',
        hasPreloadedHeroImage: true,
        merchantSlug: 'ogabassey',
      }
    );
  });
});
