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
      content:
        '<p>Editorial guide. https://www.youtube.com/watch?v=dQw4w9WgXcQ</p>',
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
        video_upload_date: '2026-11-09T12:00:00.000Z',
      },
      postUrl: 'https://ogabassey.com/blog/editorial-phone-guide',
    });

    expect(data.blogSchema.author).toEqual({
      '@type': 'Organization',
      '@id': 'https://ogabassey.com#organization',
      name: 'Ogabassey',
      url: 'https://ogabassey.com',
    });
    expect(data.videoMetadata?.schema?.author).toEqual({
      '@type': 'Organization',
      name: 'Ogabassey',
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
      content:
        '<p>Founder column. https://www.youtube.com/watch?v=dQw4w9WgXcQ</p>',
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
        video_upload_date: '2026-11-09T12:00:00.000Z',
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
    expect(data.videoMetadata?.schema?.author).toEqual({
      '@type': 'Person',
      name: 'Ogabassey',
    });
  });

  it('falls back to Person when author matches merchant name but has a registered author hub', () => {
    const data = buildBlogPostStructuredData({
      author: {
        id: 'https://ogabassey.com#author-bolakale',
        name: 'Bolakale',
        url: 'https://ogabassey.com/blog/author/bolakale',
      },
      baseUrl: 'https://ogabassey.com',
      blogIndexUrl: 'https://ogabassey.com/blog',
      content:
        '<p>Author hub guide. https://www.youtube.com/watch?v=dQw4w9WgXcQ</p>',
      merchant: {
        business_name: 'Bolakale',
        logo_url: null,
        slug: 'ogabassey',
        social_media: null,
      },
      post: {
        author_name: 'Bolakale',
        author_title: 'Senior Editor',
        category: 'Buying Guides',
        published_at: '2026-11-09T13:00:00.000Z',
        title: 'Author Hub Fallback Test',
        video_upload_date: '2026-11-09T12:00:00.000Z',
      },
      postUrl: 'https://ogabassey.com/blog/author-hub-fallback-test',
    });

    expect(data.blogSchema.author).toEqual({
      '@type': 'Person',
      '@id': 'https://ogabassey.com#author-bolakale',
      jobTitle: 'Senior Editor',
      name: 'Bolakale',
      sameAs: [
        'https://www.instagram.com/earthmover007',
        'https://www.linkedin.com/in/michael-bolakale',
      ],
      url: 'https://ogabassey.com/blog/author/bolakale',
    });
    expect(data.videoMetadata?.schema?.author).toEqual({
      '@type': 'Person',
      name: 'Bolakale',
    });
  });
});
