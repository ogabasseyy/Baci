import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OgabasseyV2Blog, type BlogPost } from './blog';

vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    <img src={src} alt={alt} />
  ),
  getImageProps: ({ src, alt }: { src: string; alt: string }) => ({
    props: { src, alt },
  }),
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

describe('OgabasseyV2Blog featured-story variants', () => {
  it('omits the featured story when the listing hero is painted outside this component', () => {
    render(
      <OgabasseyV2Blog
        hideFeaturedStory
        posts={mockPosts}
        storeSlug="/test-store"
      />
    );

    expect(screen.queryByText('Featured Story')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'The Ogabassey Blog' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /featured post/i })
    ).toBeInTheDocument();
    expect(screen.getByText('Regular Post')).toBeInTheDocument();
  });
});
