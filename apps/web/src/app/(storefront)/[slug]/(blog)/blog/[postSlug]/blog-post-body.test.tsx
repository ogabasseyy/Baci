import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BlogPostBody } from './blog-post-body';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// SafeHtml: render a plain div with a data-testid so we can inspect html prop
vi.mock('@/components/ui/safe-html', () => ({
  SafeHtml: ({
    headingLevelOffset,
    html,
    normalizeSeoAnchors,
    ...rest
  }: {
    headingLevelOffset?: number;
    html: string;
    normalizeSeoAnchors?: boolean;
    [key: string]: unknown;
  }) => (
    <div
      data-testid="safe-html"
      data-heading-level-offset={headingLevelOffset ?? ''}
      data-html={html}
      data-normalize-seo-anchors={normalizeSeoAnchors ? 'true' : 'false'}
      {...rest}
    />
  ),
}));

// Pass-through sanitizer — avoids the sanitize-html native dependency in tests
vi.mock('@/lib/sanitize', () => ({
  sanitizeHtml: (dirty: string) => dirty,
}));

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

// ---------------------------------------------------------------------------
// describe: BlogPostBody (blog-post-body.tsx)
// ---------------------------------------------------------------------------

describe('BlogPostBody', () => {
  // -------------------------------------------------------------------------
  // Content rendering — TipTap JSON path
  // -------------------------------------------------------------------------

  describe('when content is TipTap JSON (object)', () => {
    it('renders BlogContentRenderer and the Table of Contents', async () => {
      // Arrange
      const content = { type: 'doc', content: [] };

      // Act
      render(await BlogPostBody({ ...BASE_PROPS, content }));

      // Assert
      expect(screen.getByTestId('blog-content-renderer')).toBeInTheDocument();
      expect(
        screen.getByRole('navigation', { name: /table of contents/i })
      ).toBeInTheDocument();
    });

    it('passes the original content object to BlogContentRenderer', async () => {
      // Arrange
      const content = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] },
        ],
      };

      // Act
      render(await BlogPostBody({ ...BASE_PROPS, content }));

      // Assert — renderer receives the exact object, not a stringified round-trip
      expect(screen.getByTestId('blog-content-renderer').textContent).toContain(
        '"type":"doc"'
      );
    });

    it('does NOT render the SafeHtml legacy block', async () => {
      // Arrange
      const content = { type: 'doc', content: [] };

      // Act
      render(await BlogPostBody({ ...BASE_PROPS, content }));

      // Assert
      expect(screen.queryByTestId('safe-html')).not.toBeInTheDocument();
    });
  });

  describe('when content is a stringified TipTap JSON object', () => {
    it('treats a JSON string starting with "{" as JSON and uses BlogContentRenderer', async () => {
      // Arrange
      const content = JSON.stringify({ type: 'doc', content: [] });

      // Act
      render(await BlogPostBody({ ...BASE_PROPS, content }));

      // Assert
      expect(screen.getByTestId('blog-content-renderer')).toBeInTheDocument();
      expect(
        screen.getByRole('navigation', { name: /table of contents/i })
      ).toBeInTheDocument();
    });

    it('treats a JSON string starting with "[" as JSON and uses BlogContentRenderer', async () => {
      // Arrange
      const content = JSON.stringify([{ type: 'paragraph' }]);

      // Act
      render(await BlogPostBody({ ...BASE_PROPS, content }));

      // Assert
      expect(screen.getByTestId('blog-content-renderer')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Content rendering — legacy HTML path
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Content rendering — markdown path
  // -------------------------------------------------------------------------

  describe('when content is plain markdown text', () => {
    it('converts markdown to HTML and passes it to SafeHtml', async () => {
      // Arrange — marked turns "# Title" into "<h1>Title</h1>"
      const content = '# Title';

      // Act
      render(await BlogPostBody({ ...BASE_PROPS, content }));

      // Assert — SafeHtml is used (not BlogContentRenderer)
      expect(screen.getByTestId('safe-html')).toBeInTheDocument();
      expect(
        screen.queryByTestId('blog-content-renderer')
      ).not.toBeInTheDocument();

      // The data-html attribute should contain the converted heading
      const safeHtmlEl = screen.getByTestId('safe-html');
      expect(safeHtmlEl.getAttribute('data-html')).toContain('Title');
    });
  });

  // -------------------------------------------------------------------------
  // Share links
  // -------------------------------------------------------------------------

  describe('share links', () => {
    it('renders all three share buttons', async () => {
      // Arrange
      render(
        await BlogPostBody({
          ...BASE_PROPS,
          content: '<p>Body</p>',
        })
      );

      // Assert
      expect(
        screen.getByRole('link', { name: /share on twitter/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /share on linkedin/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /share on facebook/i })
      ).toBeInTheDocument();
    });

    it('Twitter share href encodes both the post title and the post URL', async () => {
      // Arrange
      const post = {
        ...BASE_POST,
        title: 'Pixel 9 Review',
        slug: 'pixel-9-review',
      };

      // Act
      render(
        await BlogPostBody({ ...BASE_PROPS, post, content: '<p>Body</p>' })
      );

      // Assert
      const expectedTitle = encodeURIComponent('Pixel 9 Review');
      const expectedUrl = encodeURIComponent(
        'https://usebaci.com/ogabassey/blog/pixel-9-review'
      );
      const twitterLink = screen.getByRole('link', {
        name: /share on twitter/i,
      });

      expect(twitterLink).toHaveAttribute(
        'href',
        expect.stringContaining(`text=${expectedTitle}`)
      );
      expect(twitterLink).toHaveAttribute(
        'href',
        expect.stringContaining(`url=${expectedUrl}`)
      );
    });

    it('LinkedIn share href encodes the post URL', async () => {
      // Arrange & Act
      render(await BlogPostBody({ ...BASE_PROPS, content: '<p>Body</p>' }));

      // Assert
      const expectedUrl = encodeURIComponent(
        'https://usebaci.com/ogabassey/blog/pixel-9-review'
      );
      expect(
        screen.getByRole('link', { name: /share on linkedin/i })
      ).toHaveAttribute('href', expect.stringContaining(expectedUrl));
    });

    it('Facebook share href encodes the post URL', async () => {
      // Arrange & Act
      render(await BlogPostBody({ ...BASE_PROPS, content: '<p>Body</p>' }));

      // Assert
      const expectedUrl = encodeURIComponent(
        'https://usebaci.com/ogabassey/blog/pixel-9-review'
      );
      expect(
        screen.getByRole('link', { name: /share on facebook/i })
      ).toHaveAttribute('href', expect.stringContaining(expectedUrl));
    });

    it('share links open in a new tab with rel="noopener noreferrer"', async () => {
      // Arrange & Act
      render(await BlogPostBody({ ...BASE_PROPS, content: '<p>Body</p>' }));

      // Assert all three social links
      for (const label of [
        /share on twitter/i,
        /share on linkedin/i,
        /share on facebook/i,
      ]) {
        const link = screen.getByRole('link', { name: label });
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      }
    });

    it('constructs the post URL from baseUrl + basePath + post slug', async () => {
      // Arrange — use a custom-domain storefront (empty basePath)
      const post = { ...BASE_POST, slug: 'my-post' };

      // Act
      render(
        await BlogPostBody({
          basePath: '',
          baseUrl: 'https://custom.example.com',
          post,
          content: '<p>Body</p>',
          relatedPosts: [],
        })
      );

      // Assert — postUrl should be baseUrl + basePath + /blog/slug
      const expectedUrl = encodeURIComponent(
        'https://custom.example.com/blog/my-post'
      );
      expect(
        screen.getByRole('link', { name: /share on twitter/i })
      ).toHaveAttribute('href', expect.stringContaining(expectedUrl));
    });
  });

  describe('related products', () => {
    it('renders valid related product links and falls back to /products routes when category is missing', async () => {
      render(
        await BlogPostBody({
          ...BASE_PROPS,
          content: '<p>Body</p>',
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

    it('omits the related products section when only malformed items are provided', async () => {
      render(
        await BlogPostBody({
          ...BASE_PROPS,
          content: '<p>Body</p>',
          relatedProducts: [
            {
              id: 'product-1',
              name: '',
              slug: '',
            },
          ],
        })
      );

      expect(
        screen.queryByRole('heading', { name: /popular products mentioned/i })
      ).not.toBeInTheDocument();
    });
    it('trims related product names and slugs before building links', async () => {
      render(
        await BlogPostBody({
          ...BASE_PROPS,
          content: '<p>Body</p>',
          relatedProducts: [
            {
              id: 'product-1',
              name: '  Galaxy S25 Ultra  ',
              slug: '  galaxy-s25-ultra  ',
              category_slug: '  smartphones  ',
            },
          ],
        })
      );

      const productLink = screen.getByRole('link', {
        name: 'Galaxy S25 Ultra',
      });

      expect(productLink).toHaveAttribute(
        'href',
        '/ogabassey/smartphones/galaxy-s25-ultra'
      );
      expect(productLink).toHaveTextContent(/^Galaxy S25 Ultra$/);
    });
  });

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------

  describe('tags', () => {
    it('renders tag badges when tags are present', async () => {
      // Arrange
      const post = { ...BASE_POST, tags: ['Android', 'Google', 'Pixel'] };

      // Act
      render(
        await BlogPostBody({ ...BASE_PROPS, post, content: '<p>Body</p>' })
      );

      // Assert
      expect(screen.getByText('Android')).toBeInTheDocument();
      expect(screen.getByText('Google')).toBeInTheDocument();
      expect(screen.getByText('Pixel')).toBeInTheDocument();
    });

    it('does not render the tags section when tags is null', async () => {
      // Arrange
      const post = { ...BASE_POST, tags: null };

      // Act
      render(
        await BlogPostBody({ ...BASE_PROPS, post, content: '<p>Body</p>' })
      );

      // Assert — no badge elements with tag-like text visible
      expect(screen.queryByText('Android')).not.toBeInTheDocument();
    });

    it('does not render the tags section when tags is an empty array', async () => {
      // Arrange
      const post = { ...BASE_POST, tags: [] };

      // Act
      render(
        await BlogPostBody({ ...BASE_PROPS, post, content: '<p>Body</p>' })
      );

      // Assert
      expect(screen.queryByText('Android')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Related posts
  // -------------------------------------------------------------------------

  describe('related posts', () => {
    it('renders the Related Articles section when related posts are provided', async () => {
      // Arrange
      const relatedPosts = [
        {
          id: 'rel-1',
          slug: 'related-post',
          title: 'Related Post',
          category: null,
          featured_image_url: null,
          published_at: null,
          reading_time_minutes: null,
        },
      ];

      // Act
      render(
        await BlogPostBody({
          ...BASE_PROPS,
          content: '<p>Body</p>',
          relatedPosts,
        })
      );

      // Assert
      expect(
        screen.getByRole('heading', { name: /related articles/i })
      ).toBeInTheDocument();
      expect(screen.getByText('Related Post')).toBeInTheDocument();
    });

    it('does not render the Related Articles section when relatedPosts is empty', async () => {
      // Arrange & Act
      render(
        await BlogPostBody({
          ...BASE_PROPS,
          content: '<p>Body</p>',
          relatedPosts: [],
        })
      );

      // Assert
      expect(
        screen.queryByRole('heading', { name: /related articles/i })
      ).not.toBeInTheDocument();
    });

    it('renders a linked card for each related post', async () => {
      // Arrange
      const relatedPosts = [
        {
          id: 'rel-1',
          slug: 'post-a',
          title: 'Post A',
          category: null,
          featured_image_url: null,
          published_at: null,
          reading_time_minutes: null,
        },
        {
          id: 'rel-2',
          slug: 'post-b',
          title: 'Post B',
          category: null,
          featured_image_url: null,
          published_at: null,
          reading_time_minutes: null,
        },
      ];

      // Act
      render(
        await BlogPostBody({
          ...BASE_PROPS,
          content: '<p>Body</p>',
          relatedPosts,
        })
      );

      // Assert
      expect(screen.getByText('Post A')).toBeInTheDocument();
      expect(screen.getByText('Post B')).toBeInTheDocument();
    });

    it('renders the category badge when a related post has a category', async () => {
      // Arrange
      const relatedPosts = [
        {
          id: 'rel-1',
          slug: 'categorised-post',
          title: 'Categorised Post',
          category: 'Smartphones',
          featured_image_url: null,
          published_at: null,
          reading_time_minutes: null,
        },
      ];

      // Act
      render(
        await BlogPostBody({
          ...BASE_PROPS,
          content: '<p>Body</p>',
          relatedPosts,
        })
      );

      // Assert
      expect(screen.getByText('Smartphones')).toBeInTheDocument();
    });

    it('renders the featured image when a related post has featured_image_url', async () => {
      // Arrange
      const relatedPosts = [
        {
          id: 'rel-1',
          slug: 'image-post',
          title: 'Image Post',
          category: null,
          featured_image_url: 'https://example.com/image.jpg',
          published_at: null,
          reading_time_minutes: null,
        },
      ];

      // Act
      render(
        await BlogPostBody({
          ...BASE_PROPS,
          content: '<p>Body</p>',
          relatedPosts,
        })
      );

      // Assert
      expect(screen.getByRole('img', { name: 'Image Post' })).toHaveAttribute(
        'src',
        'https://example.com/image.jpg'
      );
    });

    it('does not render an img element when featured_image_url is null', async () => {
      // Arrange
      const relatedPosts = [
        {
          id: 'rel-1',
          slug: 'no-image-post',
          title: 'No Image Post',
          category: null,
          featured_image_url: null,
          published_at: null,
          reading_time_minutes: null,
        },
      ];

      // Act
      render(
        await BlogPostBody({
          ...BASE_PROPS,
          content: '<p>Body</p>',
          relatedPosts,
        })
      );

      // Assert
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('renders the reading time when provided', async () => {
      // Arrange
      const relatedPosts = [
        {
          id: 'rel-1',
          slug: 'long-read',
          title: 'Long Read',
          category: null,
          featured_image_url: null,
          published_at: null,
          reading_time_minutes: 7,
        },
      ];

      // Act
      render(
        await BlogPostBody({
          ...BASE_PROPS,
          content: '<p>Body</p>',
          relatedPosts,
        })
      );

      // Assert
      expect(screen.getByText('7 min read')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Date formatting
  // -------------------------------------------------------------------------

  describe('date formatting in related posts', () => {
    it('formats published_at dates using the default en-NG locale', async () => {
      // Arrange
      const relatedPosts = [
        {
          id: 'rel-1',
          slug: 'dated-post',
          title: 'Dated Post',
          category: null,
          featured_image_url: null,
          published_at: '2026-03-01T00:00:00.000Z',
          reading_time_minutes: null,
        },
      ];

      // Act
      render(
        await BlogPostBody({
          ...BASE_PROPS,
          content: '<p>Body</p>',
          relatedPosts,
        })
      );

      // Assert — en-NG locale formats as "1 Mar 2026" (short month)
      const dateEl = screen.getByText(/mar 2026/i);
      expect(dateEl).toBeInTheDocument();
    });

    it('respects a custom locale prop for date formatting', async () => {
      // Arrange
      const relatedPosts = [
        {
          id: 'rel-1',
          slug: 'dated-post',
          title: 'Dated Post',
          category: null,
          featured_image_url: null,
          published_at: '2026-03-01T00:00:00.000Z',
          reading_time_minutes: null,
        },
      ];

      // Act — render with de-DE locale (German month name)
      render(
        await BlogPostBody({
          ...BASE_PROPS,
          locale: 'de-DE',
          content: '<p>Body</p>',
          relatedPosts,
        })
      );

      // Assert — de-DE formats with German month name
      expect(screen.getByText(/März 2026/i)).toBeInTheDocument();
    });

    it('does not render a date when published_at is null', async () => {
      // Arrange
      const relatedPosts = [
        {
          id: 'rel-1',
          slug: 'undated-post',
          title: 'Undated Post',
          category: null,
          featured_image_url: null,
          published_at: null,
          reading_time_minutes: null,
        },
      ];

      // Act
      render(
        await BlogPostBody({
          ...BASE_PROPS,
          content: '<p>Body</p>',
          relatedPosts,
        })
      );

      // Assert — no date text should appear (no year like 2026 visible)
      expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('renders without crashing when content is an empty string', async () => {
      // Arrange & Act
      render(await BlogPostBody({ ...BASE_PROPS, content: '' }));

      // Assert — share section always renders
      expect(
        screen.getByRole('link', { name: /share on twitter/i })
      ).toBeInTheDocument();
    });

    it('renders without crashing when content is null', async () => {
      // Arrange & Act — content typed as unknown to mirror real prop type
      render(await BlogPostBody({ ...BASE_PROPS, content: null as unknown }));

      // Assert
      expect(
        screen.getByRole('link', { name: /share on twitter/i })
      ).toBeInTheDocument();
    });

    it('handles content that starts with HTML angle bracket (not JSON)', async () => {
      // Arrange — a plain div without JSON shape
      const content = '<div>Not JSON</div>';

      // Act
      render(await BlogPostBody({ ...BASE_PROPS, content }));

      // Assert — takes the legacy HTML path
      expect(screen.getByTestId('safe-html')).toBeInTheDocument();
      expect(
        screen.queryByTestId('blog-content-renderer')
      ).not.toBeInTheDocument();
    });

    it('renders the share section regardless of content type', async () => {
      // Arrange — JSON path
      const jsonContent = { type: 'doc', content: [] };

      // Act
      render(await BlogPostBody({ ...BASE_PROPS, content: jsonContent }));

      // Assert
      expect(
        screen.getByRole('link', { name: /share on twitter/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /share on linkedin/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /share on facebook/i })
      ).toBeInTheDocument();
    });

    it('renders all tags when the post has multiple tags', async () => {
      // Arrange
      const post = { ...BASE_POST, tags: ['tag-a', 'tag-b', 'tag-c', 'tag-d'] };

      // Act
      render(
        await BlogPostBody({ ...BASE_PROPS, post, content: '<p>Body</p>' })
      );

      // Assert
      for (const tag of ['tag-a', 'tag-b', 'tag-c', 'tag-d']) {
        expect(screen.getByText(tag)).toBeInTheDocument();
      }
    });
  });
});
