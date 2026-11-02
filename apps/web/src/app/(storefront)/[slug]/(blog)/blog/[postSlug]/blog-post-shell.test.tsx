import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

interface MockImageProps {
  alt: string;
  fetchPriority?: string;
  fill?: boolean;
  loading?: string;
  preload?: boolean;
  quality?: number;
  sizes?: string;
  src: string;
}

// The blog post hero now renders through CdnFormatImage (explicit per-format
// <picture>). Its real pipeline calls next/image's `getImageProps`; surface it
// as a plain <img> so these tests keep asserting the LCP `preload`-only
// convention (no loading/fetchPriority pair) — not image internals.
vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: ({
    alt,
    fetchPriority,
    fill,
    loading,
    preload,
    quality,
    sizes,
    src,
  }: MockImageProps) => (
    // biome-ignore lint/performance/noImgElement: Test mock for CdnFormatImage intentionally uses <img>
    <img
      alt={alt}
      data-fetchpriority={fetchPriority ?? ''}
      data-fill={fill ? 'true' : 'false'}
      data-loading={loading ?? ''}
      data-preload={preload ? 'true' : 'false'}
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

vi.mock('lucide-react', () => ({ ArrowLeft: () => null }));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/lib/routes', () => ({ asRoute: (value: string) => value }));

const mockBlogPostHeader = vi.fn((props: unknown) => {
  const { title } = props as { title: string };
  return <h1>{title}</h1>;
});

vi.mock('./BlogPostHeader', () => ({
  BlogPostHeader: (props: unknown) => mockBlogPostHeader(props),
}));

import { BlogPostShell } from './blog-post-shell';

const header = {
  author_bio: null,
  author_name: 'Bolakale',
  author_title: null,
  authorHref: '/blog/author/bolakale',
  category: 'Reviews',
  published_at: '2026-03-16T10:05:33.654Z',
  reading_time_minutes: 4,
  title: 'The Great 5K Stall',
};

describe('BlogPostShell', () => {
  it('uses theme-aware surfaces instead of white panels around dark-mode text', () => {
    render(
      <BlogPostShell blogHref="/blog" header={header} hero={null}>
        <p>Article content</p>
      </BlogPostShell>
    );

    expect(screen.getByRole('article')).toHaveClass(
      'bg-card',
      'text-card-foreground',
      'border-border'
    );
    expect(
      screen.getByText('Back to Blog').parentElement?.parentElement
    ).toHaveClass('bg-background', 'border-border');
  });

  it('renders the hero as an LCP preload image without loading/fetchPriority', () => {
    render(
      <BlogPostShell
        blogHref="/blog"
        header={header}
        hero={{ alt: 'Studio display', src: 'https://cdn.test/hero.webp' }}
      >
        <div>body region</div>
      </BlogPostShell>
    );

    const image = screen.getByRole('img', { name: 'Studio display' });
    expect(image).toHaveAttribute('src', 'https://cdn.test/hero.webp');
    // Repo LCP convention: preload only, never the loading/fetchPriority pair.
    expect(image).toHaveAttribute('data-preload', 'true');
    expect(image).toHaveAttribute('data-loading', '');
    expect(image).toHaveAttribute('data-fetchpriority', '');
    expect(image).toHaveAttribute('data-fill', 'true');
    expect(image).toHaveAttribute('data-quality', '50');
    expect(image).toHaveAttribute(
      'data-sizes',
      '(max-width: 768px) 100vw, (max-width: 1200px) 100vw, 1200px'
    );
  });

  it('hoists the post title and streams the body region beneath it', () => {
    render(
      <BlogPostShell
        blogHref="/blog"
        header={header}
        hero={{ alt: 'Studio display', src: 'https://cdn.test/hero.webp' }}
      >
        <div>body region</div>
      </BlogPostShell>
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'The Great 5K Stall' })
    ).toBeInTheDocument();
    expect(screen.getByText('body region')).toBeInTheDocument();
    expect(mockBlogPostHeader).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'The Great 5K Stall' })
    );
  });

  it('points the breadcrumb and footer links at the blog index', () => {
    render(
      <BlogPostShell
        blogHref="/my-store/blog"
        header={header}
        hero={{ alt: 'Studio display', src: 'https://cdn.test/hero.webp' }}
      >
        <div>body region</div>
      </BlogPostShell>
    );

    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('href', '/my-store/blog');
    }
    expect(screen.getByText('Back to Blog')).toBeInTheDocument();
    expect(screen.getByText('Back to all articles')).toBeInTheDocument();
  });

  it('renders the beforeChrome slot and omits the hero when none is provided', () => {
    render(
      <BlogPostShell
        beforeChrome={<div>draft banner</div>}
        blogHref="/blog"
        header={header}
        hero={null}
      >
        <div>body region</div>
      </BlogPostShell>
    );

    expect(screen.getByText('draft banner')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
