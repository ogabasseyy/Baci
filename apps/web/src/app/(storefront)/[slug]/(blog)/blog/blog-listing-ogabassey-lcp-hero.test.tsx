import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OgabasseyBlogLcpSnapshot } from './load-ogabassey-blog-lcp-snapshot';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const SNAPSHOT: OgabasseyBlogLcpSnapshot = {
  basePath: 'https://ogabassey.com',
  featuredPost: {
    id: 'post-1',
    title: 'Featured listing post',
    slug: 'featured-listing-post',
    excerpt: 'Hero excerpt',
    category: 'News',
    author_name: 'Ogabassey',
    published_at: '2026-03-28T10:00:00.000Z',
    featured_image_url: 'https://cdn.example.com/hero.png',
    reading_time_minutes: 4,
  },
  imageSrc: 'https://cdn.example.com/hero.png',
  publishedDateLabel: 'Mar 28, 2026',
};

const snapshot = vi.hoisted(() => ({
  value: null as OgabasseyBlogLcpSnapshot | null,
}));

vi.mock('./ogabassey-blog-lcp-snapshot', () => ({
  get ogabasseyBlogLcpSnapshot() {
    return snapshot.value;
  },
}));

const { BlogListingOgabasseyLcpHero } = await import(
  './blog-listing-ogabassey-lcp-hero'
);

describe('BlogListingOgabasseyLcpHero', () => {
  beforeEach(() => {
    snapshot.value = SNAPSHOT;
  });

  it('paints the snapshot title as LCP text without a CDN image', () => {
    render(<BlogListingOgabasseyLcpHero />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Featured listing post' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /featured listing post/i })
    ).toHaveAttribute(
      'href',
      'https://ogabassey.com/blog/featured-listing-post'
    );
    expect(screen.getByText('Hero excerpt')).toHaveClass(
      'ogabassey-blog-featured-story__description'
    );
    expect(screen.getByText('Hero excerpt')).not.toHaveClass('sr-only');
    expect(
      document.querySelector('[data-cwv-lcp-copy="blog"]')
    ).toHaveTextContent('Featured listing post');
    expect(
      document.querySelector('.ogabassey-blog-featured-story__media')
    ).toBeInTheDocument();
    expect(
      document.querySelector('.ogabassey-blog-lcp-hero')
    ).toBeInTheDocument();
    expect(
      document.querySelector('.ogabassey-blog-featured-story__media img')
    ).not.toBeInTheDocument();
    expect(BlogListingOgabasseyLcpHero.constructor.name).toBe('Function');
  });

  it('does not request the untransformed JPEG that 404s on the Ogabassey CDN', () => {
    snapshot.value = {
      ...SNAPSHOT,
      imageSrc:
        'https://cdn.ogabassey.com/core-assets/blog/codex/hero/post-landscape_16x9.jpg',
    };

    const { container } = render(<BlogListingOgabasseyLcpHero />);

    expect(container.innerHTML).not.toContain(
      'core-assets/blog/codex/hero/post-landscape_16x9.jpg'
    );
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('reserves the featured-story frame when the snapshot is missing', () => {
    snapshot.value = null;

    const { container } = render(<BlogListingOgabasseyLcpHero />);

    expect(container.firstElementChild).toHaveClass('md:h-[500px]');
    expect(
      container.querySelector('.ogabassey-blog-featured-story__media')
    ).not.toBeInTheDocument();
  });
});
