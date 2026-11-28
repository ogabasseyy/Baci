import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { type BlogPost, OgabasseyV2Blog } from './blog';

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // biome-ignore lint/performance/noImgElement: test mock for next/image
    <img alt={alt} src={src} />
  ),
  getImageProps: ({ alt, src }: { alt: string; src: string }) => ({
    props: { alt, src },
  }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('../components/deferred-ad-unit', () => ({
  DeferredAdUnit: ({
    placementKey,
    slotInstance,
  }: {
    placementKey: string;
    slotInstance?: string;
  }) => (
    <div
      data-placement={placementKey}
      data-slot-instance={slotInstance}
      data-testid="deferred-ad-unit"
    />
  ),
}));

const eightPosts: BlogPost[] = Array.from({ length: 8 }, (_, idx) => ({
  id: `post-${idx + 1}`,
  title: `Post ${idx + 1}`,
  slug: `post-${idx + 1}`,
  featured: idx === 0,
  featured_image_url: `https://example.com/${idx + 1}.jpg`,
  author_name: 'Ogabassey Team',
  published_at: '2026-01-01',
  category: 'Reviews',
  excerpt: `Excerpt ${idx + 1}`,
  reading_time_minutes: 4,
}));

describe('OgabasseyV2Blog ad breaks', () => {
  it('renders a >=300px width-safe BLOG_SIDEBAR ad break after 6 grid posts on the owned Ogabassey tenant', () => {
    render(
      <OgabasseyV2Blog
        merchantSlug="ogabassey"
        posts={eightPosts}
        storeSlug="/ogabassey"
      />
    );

    const adUnits = screen.getAllByTestId('deferred-ad-unit');
    expect(adUnits).toHaveLength(1);
    expect(adUnits[0]).toHaveAttribute('data-placement', 'BLOG_SIDEBAR');
    expect(adUnits[0]).toHaveAttribute('data-slot-instance', 'blog-grid-6');
    expect(adUnits[0].parentElement).toHaveClass(
      '-mx-4',
      'hidden',
      'min-[300px]:flex',
      'sm:mx-0'
    );
  });

  it('withholds platform GAM units on third-party stores using the Ogabassey template', () => {
    render(
      <OgabasseyV2Blog
        merchantSlug="third-party-merchant"
        posts={eightPosts}
        storeSlug="/third-party-merchant"
      />
    );

    expect(screen.queryByTestId('deferred-ad-unit')).not.toBeInTheDocument();
  });

  it('withholds platform GAM units when merchantSlug is omitted', () => {
    render(<OgabasseyV2Blog posts={eightPosts} storeSlug="/unknown-store" />);

    expect(screen.queryByTestId('deferred-ad-unit')).not.toBeInTheDocument();
  });
});
