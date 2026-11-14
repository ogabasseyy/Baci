import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BlogPostBody } from './BlogPostBody';

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
  BlogContentRenderer: () => <div data-testid="blog-json-renderer" />,
}));

vi.mock('./blog-post-content', async () => {
  const actual = await vi.importActual('./blog-post-content');
  return {
    ...actual,
    resolveBlogPostContent: vi.fn().mockResolvedValue({
      isJson: true,
      legacyHtml: '',
      renderedContent: { type: 'doc', content: [] },
    }),
  };
});

vi.mock('@/lib/cached-dead-content-links', () => ({
  getCachedDeadContentLinkSlugs: vi.fn(),
}));
vi.mock('@/lib/cached-content-link-rewrites', () => ({
  getCachedContentLinkRewrites: vi
    .fn()
    .mockResolvedValue({ blogSlugs: {}, productPaths: {} }),
}));

describe('BlogPostBody related posts heading hierarchy', () => {
  it('renders related post titles as h3 under the Continue Reading h2 section', async () => {
    render(
      await BlogPostBody({
        basePath: '/ogabassey',
        baseUrl: 'https://usebaci.com',
        content: { type: 'doc', content: [] },
        merchantSlug: 'ogabassey',
        post: {
          id: 'post-1',
          slug: 'pixel-9-review',
          tags: ['Android'],
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
      screen.getByRole('heading', { level: 2, name: /Related/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Related Post' })
    ).toBeInTheDocument();
  });
});
