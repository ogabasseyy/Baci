import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlogListingFeaturedHeroView } from './blog-listing-featured-hero-view';

vi.mock('@/components/storefront/ogabassey/pages/blog-featured-story', () => ({
  BlogFeaturedStory: ({
    featuredPost,
    imageSrc,
  }: {
    featuredPost: { title: string };
    imageSrc: string;
  }) => (
    <article>
      <div className="ogabassey-blog-featured-story__media">
        {/* biome-ignore lint/performance/noImgElement: test stand-in for the featured LCP media box */}
        <img alt="" src={imageSrc} />
      </div>
      <span>{featuredPost.title}</span>
    </article>
  ),
}));

describe('BlogListingFeaturedHeroView', () => {
  it('paints the featured-story media box for the listing LCP image', () => {
    render(
      <BlogListingFeaturedHeroView
        basePath="https://ogabassey.com"
        featuredPost={{
          id: 'post-1',
          title: 'Featured listing post',
          slug: 'featured-listing-post',
          excerpt: 'Hero excerpt',
          category: 'News',
          author_name: 'Ogabassey',
          published_at: '2026-03-28T10:00:00.000Z',
          featured_image_url: 'https://cdn.example.com/hero.png',
          reading_time_minutes: 4,
        }}
        imageSrc="https://cdn.example.com/hero.png"
        publishedDateLabel="Mar 28, 2026"
      />
    );

    expect(screen.getByText('Featured listing post')).toBeInTheDocument();
    expect(
      document.querySelector('.ogabassey-blog-featured-story__media')
    ).toBeInTheDocument();
    expect(document.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/hero.png'
    );
  });
});
