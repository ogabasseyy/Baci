import { describe, expect, it } from 'vitest';
import { buildBlogPostStructuredData } from './blog-post-structured-data';

describe('buildBlogPostStructuredData', () => {
  it('adds VideoObject metadata when the post contains an owned YouTube video', () => {
    const data = buildBlogPostStructuredData({
      author: {
        name: 'Bolakale',
        url: 'https://ogabassey.com/blog/author/bolakale',
      },
      baseUrl: 'https://ogabassey.com',
      blogIndexUrl: 'https://ogabassey.com/blog',
      content:
        '<p>Watch: <a href="https://youtu.be/tp-AlU5FVpE">unboxing</a></p>',
      merchant: {
        business_name: 'Ogabassey',
        logo_url: null,
        slug: 'ogabassey',
        social_media: null,
      },
      post: {
        author_name: 'Bolakale',
        category: 'Smartphones',
        content: '<p>Body</p>',
        excerpt: 'Pixel unboxing for Nigerian buyers.',
        keywords: ['pixel', 'fold'],
        published_at: '2026-06-25T08:00:00.000Z',
        reading_time_minutes: 4,
        title: 'Google Pixel 9 Pro Fold Unboxing',
        updated_at: '2026-06-25T09:00:00.000Z',
        video_upload_date: '2026-06-20T08:00:00.000Z',
        word_count: 900,
      },
      postUrl: 'https://ogabassey.com/blog/pixel-9-pro-fold-unboxing',
    });

    expect(data.videoMetadata?.schema).toMatchObject({
      '@type': 'VideoObject',
      embedUrl: 'https://www.youtube-nocookie.com/embed/tp-AlU5FVpE',
      thumbnailUrl: ['https://i.ytimg.com/vi/tp-AlU5FVpE/hqdefault.jpg'],
      uploadDate: '2026-06-20T08:00:00.000Z',
    });
    expect(data.blogSchema).toMatchObject({
      '@type': 'BlogPosting',
      articleSection: 'Smartphones',
      headline: 'Google Pixel 9 Pro Fold Unboxing',
    });
  });

  it('keeps the video preview but skips VideoObject when video upload date is unknown', () => {
    const data = buildBlogPostStructuredData({
      author: {
        name: 'Bolakale',
        url: 'https://ogabassey.com/blog/author/bolakale',
      },
      baseUrl: 'https://ogabassey.com',
      blogIndexUrl: 'https://ogabassey.com/blog',
      content:
        '<p>Watch: <a href="https://youtu.be/tp-AlU5FVpE">unboxing</a></p>',
      merchant: {
        business_name: 'Ogabassey',
        logo_url: null,
        slug: 'ogabassey',
        social_media: null,
      },
      post: {
        author_name: 'Bolakale',
        category: 'Smartphones',
        content: '<p>Body</p>',
        excerpt: 'Pixel unboxing for Nigerian buyers.',
        keywords: ['pixel', 'fold'],
        published_at: '2026-06-25T08:00:00.000Z',
        reading_time_minutes: 4,
        title: 'Google Pixel 9 Pro Fold Unboxing',
        updated_at: '2026-06-25T09:00:00.000Z',
        word_count: 900,
      },
      postUrl: 'https://ogabassey.com/blog/pixel-9-pro-fold-unboxing',
    });

    expect(data.videoMetadata?.video.videoId).toBe('tp-AlU5FVpE');
    expect(data.videoMetadata?.schema).toBeNull();
  });

  it('leaves video metadata empty when the post has no supported video link', () => {
    const data = buildBlogPostStructuredData({
      author: {
        name: 'Bolakale',
        url: 'https://ogabassey.com/blog/author/bolakale',
      },
      baseUrl: 'https://ogabassey.com',
      blogIndexUrl: 'https://ogabassey.com/blog',
      content: '<p>This ordinary buyer guide has no embedded video.</p>',
      merchant: {
        business_name: 'Ogabassey',
        logo_url: null,
        slug: 'ogabassey',
        social_media: null,
      },
      post: {
        author_name: 'Bolakale',
        category: 'Smartphones',
        content: '<p>Body</p>',
        excerpt: 'Pixel buying guide for Nigerian buyers.',
        keywords: ['pixel', 'camera'],
        published_at: '2026-06-25T08:00:00.000Z',
        reading_time_minutes: 4,
        title: 'Google Pixel Buying Guide',
        updated_at: '2026-06-25T09:00:00.000Z',
        word_count: 900,
      },
      postUrl: 'https://ogabassey.com/blog/google-pixel-buying-guide',
    });

    expect(data.videoMetadata).toBeNull();
    expect(data.blogSchema).toMatchObject({
      '@type': 'BlogPosting',
      headline: 'Google Pixel Buying Guide',
    });
  });

  it('keeps plain-text ampersands single-encoded alongside a price token', () => {
    // Arrange: token resolution runs the plain-text description through the
    // HTML sanitizer, which escapes `&` as `&amp;`.
    const productId = '11111111-1111-4111-8111-111111111111';
    const data = buildBlogPostStructuredData({
      catalogPrices: {
        products: [
          { id: productId, name: 'Phone', price: 250000, manage_stock: false },
        ],
        currencySource: { country: 'NG', payout_currency: 'NGN' },
      },
      author: {
        name: 'Bolakale',
        url: 'https://ogabassey.com/blog/author/bolakale',
      },
      baseUrl: 'https://ogabassey.com',
      blogIndexUrl: 'https://ogabassey.com/blog',
      content: '<p>Guide body.</p>',
      merchant: {
        business_name: 'Ogabassey',
        logo_url: null,
        slug: 'ogabassey',
        social_media: null,
      },
      post: {
        published_at: '2026-06-25T08:00:00.000Z',
        seo_description: `Phones from AT&T partner stores: {{catalog-price:${productId}}}.`,
        title: 'Buying guide',
      },
      postUrl: 'https://ogabassey.com/blog/buying-guide',
    });

    // Assert: the schema stores the literal text (unicode-escaped once by
    // the shared schema sanitizer), not the double-encoded entity.
    expect(data.blogSchema.description).toContain('AT\\u0026T');
    expect(data.blogSchema.description).toContain('₦250,000.00');
    expect(data.blogSchema.description).not.toContain('amp;');
  });
});
