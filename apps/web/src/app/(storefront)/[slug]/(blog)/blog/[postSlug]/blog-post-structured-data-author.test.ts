import { describe, expect, it } from 'vitest';
import { buildBlogPostStructuredData } from './blog-post-structured-data';

describe('buildBlogPostStructuredData author classification', () => {
  it('emits Organization author @type when author falls back to merchant business name', () => {
    const data = buildBlogPostStructuredData({
      author: {
        name: 'Ogabassey',
        url: 'https://ogabassey.com',
      },
      baseUrl: 'https://ogabassey.com',
      blogIndexUrl: 'https://ogabassey.com/blog',
      content: '<p>Editorial guide.</p>',
      merchant: {
        business_name: 'Ogabassey',
        logo_url: null,
        slug: 'ogabassey',
        social_media: null,
      },
      post: {
        author_name: null,
        author_title: 'Editorial Desk',
        category: 'Buying Guides',
        published_at: '2026-11-09T13:00:00.000Z',
        title: 'Editorial Phone Guide',
      },
      postUrl: 'https://ogabassey.com/blog/editorial-phone-guide',
    });

    expect(data.blogSchema.author).toEqual({
      '@type': 'Organization',
      '@id': 'https://ogabassey.com#organization',
      name: 'Ogabassey',
      url: 'https://ogabassey.com',
    });
  });

  it('honors explicit Person author type even when author name matches merchant', () => {
    const data = buildBlogPostStructuredData({
      author: {
        id: 'https://ogabassey.com/blog/author/ogabassey#person',
        name: 'Ogabassey',
        type: 'Person',
        url: 'https://ogabassey.com/blog/author/ogabassey',
      },
      baseUrl: 'https://ogabassey.com',
      blogIndexUrl: 'https://ogabassey.com/blog',
      content: '<p>Founder column.</p>',
      merchant: {
        business_name: 'Ogabassey',
        logo_url: null,
        slug: 'ogabassey',
        social_media: null,
      },
      post: {
        author_name: 'Ogabassey',
        author_title: 'Founder',
        category: 'News',
        published_at: '2026-11-09T13:00:00.000Z',
        title: 'Founder Column',
      },
      postUrl: 'https://ogabassey.com/blog/founder-column',
    });

    expect(data.blogSchema.author).toEqual({
      '@type': 'Person',
      '@id': 'https://ogabassey.com/blog/author/ogabassey#person',
      jobTitle: 'Founder',
      name: 'Ogabassey',
      url: 'https://ogabassey.com/blog/author/ogabassey',
    });
  });
});
