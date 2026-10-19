import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BlogPostBody } from './blog-post-body';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// BlogContentRenderer — lightweight stub; expose json so assertions can read it
vi.mock('@/components/blog/renderer/BlogContentRenderer', () => ({
  BlogContentRenderer: ({ json }: { json: unknown }) => (
    <div data-testid="blog-content-renderer">{JSON.stringify(json)}</div>
  ),
}));

// TableOfContents — render a navigational landmark so role queries work
vi.mock('@/components/blog/table-of-contents', () => ({
  TableOfContents: () => (
    <nav aria-label="Table of contents">Table of contents</nav>
  ),
}));

// next/image — render a standard <img> (no fill / priority attributes)
vi.mock('next/image', () => ({
  default: ({
    alt,
    fill: _fill,
    src,
    ...rest
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    alt: string;
    fill?: boolean;
    src: string;
    // biome-ignore lint/performance/noImgElement: test mock for next/image
  }) => <img alt={alt} src={src} {...rest} />,
}));

// next/link — render a plain <a> tag
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE_POST = {
  id: 'post-1',
  slug: 'pixel-9-review',
  title: 'Pixel 9 Review',
  tags: null as string[] | null,
  author_bio: null as string | null,
};

const BASE_PROPS = {
  basePath: '/ogabassey',
  baseUrl: 'https://usebaci.com',
  post: BASE_POST,
  relatedProducts: [] as Array<{
    category_slug?: string | null;
    id: string;
    name: string;
    slug: string;
  }>,
  relatedPosts: [] as Array<{
    category?: string | null;
    featured_image_url?: string | null;
    id: string;
    published_at?: string | null;
    reading_time_minutes?: number | null;
    slug: string;
    title: string;
  }>,
};

describe('BlogPostBody legacy rendering', () => {
  describe('when content is a legacy HTML string', () => {
    it('renders SafeHtml and NOT BlogContentRenderer', async () => {
      // Arrange
      const content = '<p>Legacy HTML body</p>';

      // Act
      render(await BlogPostBody({ ...BASE_PROPS, content }));

      // Assert
      expect(screen.getByText('Legacy HTML body')).toBeInTheDocument();
      expect(
        screen.queryByTestId('blog-content-renderer')
      ).not.toBeInTheDocument();
    });

    it('passes the raw HTML string to SafeHtml as-is', async () => {
      // Arrange
      const content = '<p>Hello world</p>';

      // Act
      render(await BlogPostBody({ ...BASE_PROPS, content }));

      // Assert
      expect(screen.getByText('Hello world')).toBeInTheDocument();
    });

    it('does not hide legacy inline images with a broad first-image selector', async () => {
      const content =
        '<p><picture><img src="/inline.png" alt="Inline" /></picture></p>';

      render(await BlogPostBody({ ...BASE_PROPS, content }));

      expect(
        screen
          .getByRole('img', { name: 'Inline' })
          .closest('.prose-baci')
          ?.getAttribute('class')
      ).not.toContain('img:first-of-type');
      expect(
        screen.getByRole('img', { name: 'Inline' }).closest('.prose-baci')
          ?.className
      ).not.toMatch(/\[&_a\]:text-/);
    });

    it('does NOT render the Table of Contents for legacy HTML', async () => {
      // Arrange
      const content = '<p>Some legacy body</p>';

      // Act
      render(await BlogPostBody({ ...BASE_PROPS, content }));

      // Assert
      expect(
        screen.queryByRole('navigation', { name: /table of contents/i })
      ).not.toBeInTheDocument();
    });
  });
});
