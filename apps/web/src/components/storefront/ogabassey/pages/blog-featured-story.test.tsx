import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { BlogPostData } from '@/templates/registry';
import { BLOG_LISTING_FEATURED_IMAGE_SIZES } from '@/components/storefront/ogabassey/config/blog-media';
import { BlogFeaturedStory } from './blog-featured-story';

interface MockCdnFormatImageProps {
  alt: string;
  fetchPriority?: 'high' | 'low' | 'auto';
  fill?: boolean;
  loading?: 'eager' | 'lazy';
  preload?: boolean;
  priority?: boolean;
  quality?: number;
  sizes?: string;
  src: string;
}

// The featured story now renders through CdnFormatImage (explicit per-format
// <picture>). Its real pipeline calls next/image's `getImageProps`; surface it
// as a plain <img> so these tests keep asserting the LCP image contract
// (decorative, eager, high-priority, q50) — not image internals.
vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: ({
    alt,
    fetchPriority,
    fill,
    loading,
    preload,
    priority,
    quality,
    sizes,
    src,
  }: MockCdnFormatImageProps) => (
    <img
      alt={alt}
      data-fetchpriority={fetchPriority}
      data-fill={fill ? 'true' : 'false'}
      data-loading={loading}
      data-preload={preload ? 'true' : 'false'}
      data-priority={priority ? 'true' : 'false'}
      data-quality={quality === undefined ? '' : String(quality)}
      data-sizes={sizes}
      src={src}
    />
  ),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('BlogFeaturedStory', () => {
  const featuredPost = {
    category: 'Tech News',
    excerpt: 'Useful buying guidance.',
    featured_image_url: 'https://example.com/original.jpg',
    id: 'post-1',
    published_at: '2026-06-24T00:00:00.000Z',
    slug: 'featured-post',
    title: 'Featured Post',
  } as BlogPostData;

  it('renders the featured story image as decorative eager high-priority LCP content', () => {
    const { container } = render(
      <BlogFeaturedStory
        basePath="/ogabassey"
        featuredPost={featuredPost}
        imageSrc="https://example.com/featured.jpg"
        publishedDateLabel="24 Jun 2026"
      />
    );

    const articleLink = screen.getByRole('link', { name: /featured post/i });
    expect(articleLink).toHaveAttribute('href', '/ogabassey/blog/featured-post');

    expect(screen.queryByRole('img', { name: 'Featured Post' })).not.toBeInTheDocument();

    const image = container.querySelector('img');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('src', 'https://example.com/featured.jpg');
    expect(image).toHaveAttribute('data-preload', 'false');
    expect(image).toHaveAttribute('data-loading', 'eager');
    expect(image).toHaveAttribute('data-fetchpriority', 'high');
    expect(image).toHaveAttribute('data-priority', 'false');
    expect(image).toHaveAttribute('data-fill', 'true');
    expect(image).toHaveAttribute(
      'data-sizes',
      BLOG_LISTING_FEATURED_IMAGE_SIZES
    );
    // Shared lighter blog hero quality to cut the measured Slow-4G LCP bytes.
    expect(image).toHaveAttribute('data-quality', '50');
    expect(screen.getByText('24 Jun 2026')).toBeInTheDocument();
  });

  it('uses theme-aware badge colors and contrast-safe image overlay classes', () => {
    const { container } = render(
      <BlogFeaturedStory
        basePath="/ogabassey"
        featuredPost={featuredPost}
        imageSrc="https://example.com/featured.jpg"
        publishedDateLabel="24 Jun 2026"
      />
    );

    const badge = screen.getByText('Featured Story');
    expect(badge).toHaveClass('bg-store-primary');
    expect(badge).toHaveClass('text-store-primary-text');
    expect(badge).not.toHaveClass('bg-red-600');

    expect(
      container.querySelector('.ogabassey-blog-featured-story__media')
    ).toBeInTheDocument();
    expect(
      container.querySelector('.ogabassey-blog-featured-story__scrim')
    ).toBeInTheDocument();

    const heading = screen.getByRole('heading', { name: 'Featured Post' });
    expect(heading).toHaveClass('ogabassey-blog-featured-story__title');
    expect(heading).not.toHaveClass('group-hover:text-red-50');
  });
});
