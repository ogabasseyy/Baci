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
  default: ({
    children,
    prefetch,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a
      {...props}
      data-prefetch={prefetch !== undefined ? String(prefetch) : undefined}
    >
      {children}
    </a>
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
  BlogContentRenderer: () => <div data-testid="blog-json-renderer" />,
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

describe('BlogPostBody related-article link prefetching', () => {
  afterEach(() => {
    mockGetCachedDeadContentLinkSlugs.mockReset();
    mockResolveBlogPostContent.mockReset();
  });

  it('disables eager prefetch on Related Articles links', async () => {
    mockResolveBlogPostContent.mockResolvedValue({
      isJson: true,
      legacyHtml: '',
      renderedContent: { type: 'doc', content: [] },
    });

    render(
      await BlogPostBody({
        basePath: '/ogabassey',
        baseUrl: 'https://usebaci.com',
        content: { type: 'doc', content: [] },
        merchantSlug: 'ogabassey',
        post: {
          id: 'post-1',
          slug: 'pixel-9-review',
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

    expect(screen.getByRole('link', { name: /Related Post/i })).toHaveAttribute(
      'data-prefetch',
      'false'
    );
  });
});
