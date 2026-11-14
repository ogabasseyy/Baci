import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OgabasseyV2Blog, type BlogPost } from './blog';
import { BLOG_LISTING_FEATURED_IMAGE_SIZES } from '../config/blog-media';

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

describe('OgabasseyV2Blog - Featured LCP Image', () => {
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
    expect(featuredImage).toHaveAttribute(
      'sizes',
      BLOG_LISTING_FEATURED_IMAGE_SIZES
    );
  });
});
