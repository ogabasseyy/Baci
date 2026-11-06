import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOG_LISTING_FEATURED_IMAGE_SIZES } from '@/components/storefront/ogabassey/config/blog-media';
import { preloadBlogListingFeaturedImage } from './blog-listing-featured-image-preload';
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

// Restore the real next/image getImageProps (global vitest.setup mocks next/image
// with only a default export) so CdnFormatImage builds its production <picture>.
vi.mock('next/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/image')>();
  return { ...actual };
});

vi.mock('./blog-listing-featured-image-preload', () => ({
  preloadBlogListingFeaturedImage: vi.fn(),
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
    featured_image_url:
      'https://cdn.ogabassey.com/core-assets/blog/codex/hero/post-landscape_16x9.jpg',
    reading_time_minutes: 4,
  },
  imageSrc:
    'https://cdn.ogabassey.com/core-assets/blog/codex/hero/post-landscape_16x9.jpg',
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
    vi.clearAllMocks();
    snapshot.value = SNAPSHOT;
  });

  it('renders the snapshot featured story with an optimized CDN image and preloads it', () => {
    const { container } = render(<BlogListingOgabasseyLcpHero />);

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    const featuredLink = screen.getByRole('link', {
      name: /featured listing post/i,
    });
    expect(featuredLink).toHaveAttribute(
      'href',
      'https://ogabassey.com/blog/featured-listing-post'
    );
    expect(featuredLink).toHaveClass('ogabassey-blog-lcp-hero__frame');
    expect(document.querySelector('.ogabassey-blog-lcp-hero')?.tagName).toBe(
      'DIV'
    );
    expect(featuredLink.closest('.ogabassey-blog-lcp-hero')).toBe(
      document.querySelector('.ogabassey-blog-lcp-hero')
    );
    expect(screen.queryByText('Hero excerpt')).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-cwv-lcp-copy="blog"]')
    ).toHaveTextContent('Featured listing post');
    expect(
      document.querySelector('.ogabassey-blog-featured-story__media')
    ).toBeInTheDocument();
    expect(
      document.querySelector('.ogabassey-blog-featured-story__scrim')
    ).toBeInTheDocument();
    expect(
      document.querySelector('.ogabassey-blog-lcp-hero')
    ).toBeInTheDocument();

    expect(preloadBlogListingFeaturedImage).toHaveBeenCalledTimes(1);
    expect(preloadBlogListingFeaturedImage).toHaveBeenCalledWith(
      SNAPSHOT.imageSrc
    );

    const source = container.querySelector('picture source[type="image/avif"]');
    expect(source).not.toBeNull();
    expect(source?.getAttribute('srcset')).toContain('format=avif');
    expect(source?.getAttribute('srcset')).toContain('quality=50');
    expect(source).toHaveAttribute('sizes', BLOG_LISTING_FEATURED_IMAGE_SIZES);

    const image = container.querySelector(
      '.ogabassey-blog-featured-story__media picture img'
    );
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('loading', 'eager');
    expect(image).toHaveAttribute('fetchpriority', 'high');
    expect(image).toHaveAttribute('sizes', BLOG_LISTING_FEATURED_IMAGE_SIZES);
    expect(image?.getAttribute('src')).toContain('format=jpeg');
    expect(image?.getAttribute('srcset')).toContain('format=jpeg');
    expect(BlogListingOgabasseyLcpHero.constructor.name).toBe('Function');
  });

  it('never emits the untransformed JPEG URL that 404s on the Ogabassey CDN as img src', () => {
    const rawUrl =
      'https://cdn.ogabassey.com/core-assets/blog/codex/hero/post-landscape_16x9.jpg';
    snapshot.value = {
      ...SNAPSHOT,
      imageSrc: rawUrl,
    };

    const { container } = render(<BlogListingOgabasseyLcpHero />);

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).not.toBe(rawUrl);
    expect(image?.getAttribute('src')).toContain(
      '/image/width=3840,quality=50,format=jpeg/core-assets/blog/codex/hero/post-landscape_16x9.jpg'
    );
  });

  it('reserves the featured-story frame when the snapshot is missing', () => {
    snapshot.value = null;

    const { container } = render(<BlogListingOgabasseyLcpHero />);

    expect(container.firstElementChild).toHaveClass('md:h-[500px]');
    expect(
      container.querySelector('.ogabassey-blog-featured-story__media')
    ).not.toBeInTheDocument();
    expect(preloadBlogListingFeaturedImage).not.toHaveBeenCalled();
  });
});
