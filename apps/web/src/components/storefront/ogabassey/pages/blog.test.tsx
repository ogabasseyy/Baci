import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OgabasseyV2Blog, type BlogPost } from './blog';

interface MockNextImageProps {
  alt: string;
  fetchPriority?: 'high' | 'low' | 'auto';
  fill?: boolean;
  loading?: 'eager' | 'lazy';
  preload?: boolean;
  priority?: boolean;
  sizes?: string;
  src: string;
  [key: string]: unknown;
}

vi.mock('next/image', () => ({
    default: ({
      src,
      alt,
      preload,
      priority,
      loading,
      fill,
      sizes,
      fetchPriority,
      ...props
    }: MockNextImageProps) => (
      <img
        src={src}
        alt={alt}
        data-preload={preload ? 'true' : 'false'}
        data-priority={priority ? 'true' : 'false'}
        data-loading={loading}
        data-fill={fill ? 'true' : 'false'}
        data-fetchpriority={fetchPriority}
        data-sizes={sizes}
        data-testid="next-image"
        {...props}
      />
    ),
    getImageProps: ({
      fill: _fill,
      loader: _loader,
      preload: _preload,
      priority: _priority,
      quality: _quality,
      ...props
    }: MockNextImageProps & {
      loader?: unknown;
      quality?: number;
    }) => ({ props }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('./ad-unit', () => ({
  AdUnit: () => <div data-testid="ad-unit" />,
}));

describe('OgabasseyV2Blog', () => {
  const mockPosts: BlogPost[] = [
    {
      id: '1',
      title: 'Featured Post',
      slug: 'featured-post',
      featured: true,
      featured_image_url: 'https://example.com/featured.jpg',
      author_name: 'Ogabassey Team',
      published_at: '2023-01-01',
      category: 'Tech News',
      excerpt: 'Featured excerpt',
      reading_time_minutes: 4,
    },
    {
      id: '2',
      title: 'Regular Post',
      slug: 'regular-post',
      featured: false,
      featured_image_url: 'https://example.com/regular.jpg',
      author_name: 'Ogabassey Team',
      published_at: '2023-01-02',
      category: 'Reviews',
      excerpt: 'Regular excerpt',
      reading_time_minutes: 3,
    },
  ];

  it('renders the featured post as the server LCP image', () => {
    render(<OgabasseyV2Blog posts={mockPosts} storeSlug="/test-store" />);

    const featuredImage = screen
      .getByRole('link', { name: /featured post/i })
      .querySelector('img');

    expect(featuredImage).toBeInTheDocument();
    expect(featuredImage).toHaveAttribute(
      'src',
      'https://example.com/featured.jpg'
    );
    expect(featuredImage).toHaveAttribute('loading', 'eager');
    expect(featuredImage).toHaveAttribute('fetchpriority', 'high');
    expect(featuredImage).toHaveAttribute('sizes', '100vw');
  });

  it('renders grid posts with lazy low-priority images', () => {
    render(<OgabasseyV2Blog posts={mockPosts} storeSlug="/test-store" />);

    const gridImage = screen
      .getAllByTestId('next-image')
      .find((img) => img.getAttribute('src') === 'https://example.com/regular.jpg');

    expect(gridImage).toBeInTheDocument();
    expect(gridImage).toHaveAttribute('data-loading', 'lazy');
    expect(gridImage).toHaveAttribute('data-fetchpriority', 'low');
    expect(gridImage).toHaveAttribute('data-fill', 'true');
    expect(gridImage).toHaveAttribute(
      'data-sizes',
      '(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw'
    );
    expect(gridImage).toHaveAttribute('quality', '50');
  });

  it('falls back before rendering Next Image when blog image URLs are malformed', () => {
    render(
      <OgabasseyV2Blog
        posts={[
          {
            ...mockPosts[0],
            featured_image_url: 'legacy-featured.jpg',
          },
          {
            ...mockPosts[1],
            featured_image_url: 'javascript:alert(1)',
          },
        ]}
        storeSlug="/test-store"
      />
    );

    const featuredLink = screen.getByRole('link', { name: /featured post/i });
    expect(featuredLink.querySelector('img')).toHaveAttribute('src', '/placeholder.png');
    expect(screen.queryByRole('img', { name: 'Featured Post' })).not.toBeInTheDocument();

    expect(screen.getByRole('img', { name: 'Regular Post' })).toHaveAttribute(
      'src',
      '/placeholder.png'
    );
  });

  it('uses crawlable canonical category paths instead of redirecting query links', () => {
    render(
      <OgabasseyV2Blog
        posts={mockPosts}
        storeSlug="/test-store"
        categories={[
          { name: 'Tech News', slug: 'tech-news' },
          { name: 'Tips and Tricks', slug: 'tips-and-tricks' },
        ]}
      />
    );

    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute(
      'href',
      '/test-store/blog'
    );
    expect(screen.getByRole('link', { name: 'Tech News' })).toHaveAttribute(
      'href',
      '/test-store/blog/category/tech-news'
    );
  });

  it('keeps hard-coded chips without published posts on the query form', () => {
    render(
      <OgabasseyV2Blog
        posts={mockPosts}
        storeSlug="/test-store"
        categories={[{ name: 'Tech News', slug: 'tech-news' }]}
      />
    );

    // the clean category route notFound()s slugs with no published posts, so
    // a post-less hard-coded chip must keep the non-redirecting query form
    expect(
      screen.getByRole('link', { name: 'Mobile Gadgets' })
    ).toHaveAttribute('href', '/test-store/blog?category=Mobile%20Gadgets');
    expect(screen.getByRole('link', { name: 'Tech News' })).toHaveAttribute(
      'href',
      '/test-store/blog/category/tech-news'
    );
  });

  it('normalizes a bare merchant-slug basePath into a rooted category path', () => {
    render(
      <OgabasseyV2Blog
        posts={mockPosts}
        storeSlug="test-store"
        categories={[
          { name: 'Tech News', slug: 'tech-news' },
          { name: 'Tips and Tricks', slug: 'tips-and-tricks' },
        ]}
      />
    );

    expect(screen.getByRole('link', { name: 'Tech News' })).toHaveAttribute(
      'href',
      '/test-store/blog/category/tech-news'
    );
  });

  it('uses the server-selected category to filter and mark the active link', () => {
    render(
      <OgabasseyV2Blog
        posts={mockPosts}
        storeSlug="/test-store"
        category="Reviews"
      />
    );

    expect(screen.getByText('Regular Post')).toBeInTheDocument();
    expect(screen.queryByText('Featured Post')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reviews' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('keeps invalid date strings visible and machine-readable instead of throwing', () => {
    render(
      <OgabasseyV2Blog
        posts={[
          {
            ...mockPosts[0],
            id: 'invalid-date-post',
            published_at: 'not-a-date',
          },
        ]}
        storeSlug="/test-store"
      />
    );

    const dateLabel = screen.getByText('not-a-date');

    expect(dateLabel.tagName.toLowerCase()).toBe('time');
    expect(dateLabel).toHaveAttribute('datetime', 'not-a-date');
  });

  it('keeps the green tips CTA inside the published category taxonomy', () => {
    render(
      <OgabasseyV2Blog
        posts={mockPosts}
        storeSlug="/test-store"
        categories={[
          { name: 'Tech News', slug: 'tech-news' },
          { name: 'Tips and Tricks', slug: 'tips-and-tricks' },
        ]}
      />
    );

    expect(screen.getByRole('link', { name: 'View Green Tips' })).toHaveAttribute(
      'href',
      '/test-store/blog/category/tips-and-tricks'
    );
  });

  it('renders UTC-stable date labels to avoid hydration drift', () => {
    render(
      <OgabasseyV2Blog
        posts={[
          {
            ...mockPosts[0],
            id: 'timezone-boundary-post',
            published_at: '2026-03-28T23:30:00.000Z',
          },
        ]}
        storeSlug="/test-store"
      />
    );

    expect(screen.getByText('Mar 28, 2026')).toBeInTheDocument();
  });
});
