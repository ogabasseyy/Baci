import { describe, expect, it } from 'vitest';
import { buildBlogListingFeaturedStory } from './blog-listing-featured-story';

describe('buildBlogListingFeaturedStory', () => {
  it('maps listing fields onto the featured-story view model', () => {
    const result = buildBlogListingFeaturedStory(
      {
        id: 'post-1',
        title: 'Featured listing post',
        slug: 'featured-listing-post',
        excerpt: 'Hero excerpt',
        category: 'News',
        author_name: 'Editor',
        published_at: '2026-03-28T10:00:00.000Z',
        featured_image_url: 'https://cdn.example.com/hero.png',
        reading_time_minutes: 4,
      },
      'Ogabassey'
    );

    expect(result.featuredPost).toEqual({
      id: 'post-1',
      title: 'Featured listing post',
      slug: 'featured-listing-post',
      excerpt: 'Hero excerpt',
      category: 'News',
      author_name: 'Editor',
      published_at: '2026-03-28T10:00:00.000Z',
      featured_image_url: 'https://cdn.example.com/hero.png',
      reading_time_minutes: 4,
    });
    expect(result.publishedDateLabel).toBe('Mar 28, 2026');
  });

  it('falls back to the merchant name and empty copy when optional fields are missing', () => {
    const result = buildBlogListingFeaturedStory(
      {
        title: 'Untitled',
        slug: 'untitled',
      },
      'Ogabassey'
    );

    expect(result.featuredPost.id).toBe('untitled');
    expect(result.featuredPost.author_name).toBe('Ogabassey');
    expect(result.featuredPost.excerpt).toBe('');
    expect(result.featuredPost.reading_time_minutes).toBe(3);
    expect(result.publishedDateLabel).toBe('');
  });
});
