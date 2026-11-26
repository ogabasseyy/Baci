import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BLOG_LISTING_CARD_IMAGE_SIZES } from '@/components/storefront/ogabassey/config/blog-media';
import type { BlogPostData } from '@/templates/registry';
import { BlogPostCard } from './blog-post-card';

// Restore real next/image getImageProps so CdnFormatImage emits the real
// per-format <picture> (<source type="image/avif"> + jpeg <img> fallback).
vi.mock('next/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/image')>();
  return { ...actual };
});

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a
      href={href}
      data-prefetch={prefetch === undefined ? undefined : String(prefetch)}
      {...props}
    >
      {children}
    </a>
  ),
}));

describe('BlogPostCard', () => {
  const post: BlogPostData = {
    id: 'post-2',
    title: 'Regular Post',
    slug: 'regular-post',
    excerpt: 'Helpful review summary.',
    category: 'Reviews',
    author_name: '',
    published_at: '2026-03-27T00:00:00.000Z',
    reading_time_minutes: 4,
    featured_image_url:
      'https://cdn.ogabassey.com/core-assets/blog/regular-post.jpg',
  };

  it('uses a non-prefetching stretched link on the h2 title and renders capped AVIF picture tiers for CDN images', () => {
    const { container } = render(
      <BlogPostCard
        href="/test-store/blog/regular-post"
        imageSrc="https://cdn.ogabassey.com/core-assets/blog/regular-post.jpg"
        post={post}
        publishedDateLabel="Mar 27, 2026"
      />
    );

    const cardLink = screen.getByRole('link', { name: 'Regular Post' });
    expect(cardLink).toHaveAttribute('href', '/test-store/blog/regular-post');
    expect(cardLink).toHaveAttribute('data-prefetch', 'false');
    expect(cardLink.closest('h2')).toBeInTheDocument();
    expect(cardLink.closest('article')).toBeInTheDocument();
    expect(cardLink.querySelector('img')).not.toBeInTheDocument();

    const avifSource = container.querySelector(
      'picture source[type="image/avif"]'
    );
    expect(avifSource).not.toBeNull();
    expect(avifSource).toHaveAttribute('sizes', BLOG_LISTING_CARD_IMAGE_SIZES);
    const avifSrcSet = avifSource?.getAttribute('srcset') ?? '';
    expect(avifSrcSet).toContain('format=avif');
    expect(avifSrcSet).toContain('quality=50');
    expect(avifSrcSet).toContain('384w');
    expect(avifSrcSet).toContain('640w');
    expect(avifSrcSet).toContain('750w');
    expect(avifSrcSet).not.toContain('256w');
    expect(avifSrcSet).not.toContain('828w');
    expect(avifSrcSet).not.toContain('1080w');
    expect(avifSrcSet).not.toContain('1200w');
    expect(avifSrcSet).not.toContain('format=auto');
    expect(avifSrcSet).not.toContain('format=jpeg');

    const image = screen.getByRole('img', { name: 'Regular Post' });
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('fetchpriority', 'low');
    expect(image).toHaveAttribute('sizes', BLOG_LISTING_CARD_IMAGE_SIZES);
    expect(image.getAttribute('src')).toContain('width=750,quality=50,format=jpeg');
    expect(image.getAttribute('srcset')).toContain('format=jpeg');
    expect(image.getAttribute('srcset')).not.toContain('1080w');
    expect(image.getAttribute('srcset')).not.toContain('1200w');
    expect(image).not.toHaveAttribute('minSrcSetWidth');
    expect(image).not.toHaveAttribute('maxSrcSetWidth');
    expect(screen.getByText('Ogabassey Team')).toBeInTheDocument();
    expect(screen.getByText('4 MIN READ')).toBeInTheDocument();
  });

  it('renders a capped plain <img> without AVIF source for non-CDN images', () => {
    const { container } = render(
      <BlogPostCard
        href="/test-store/blog/regular-post"
        imageSrc="https://cdn.example.com/regular.jpg"
        post={post}
        publishedDateLabel="Mar 27, 2026"
      />
    );

    expect(container.querySelector('picture')).toBeNull();
    expect(container.querySelector('source')).toBeNull();

    const image = screen.getByRole('img', { name: 'Regular Post' });
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('fetchpriority', 'low');
    expect(image).toHaveAttribute('sizes', BLOG_LISTING_CARD_IMAGE_SIZES);
    expect(image.getAttribute('src')).toBe(
      'https://cdn.example.com/regular.jpg?w=750&q=50'
    );
    expect(image.getAttribute('srcset')).toBe(
      'https://cdn.example.com/regular.jpg?w=384&q=50 384w, https://cdn.example.com/regular.jpg?w=640&q=50 640w, https://cdn.example.com/regular.jpg?w=750&q=50 750w'
    );
  });
});
