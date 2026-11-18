import { describe, expect, it } from 'vitest';
import { buildBlogRssFeedXml } from './build-blog-rss-feed';

describe('buildBlogRssFeedXml', () => {
  it('builds RSS 2.0 XML using custom domain URLs and falls back when custom domain is invalid', () => {
    const xml = buildBlogRssFeedXml({
      baseUrl: 'https://usebaci.com',
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Ogabassey',
        site_description: 'Tech guides',
        logo_url: 'https://cdn.ogabassey.com/logo.png',
        custom_domain: 'ogabassey.com',
      },
      posts: [
        {
          id: 'post-1',
          title: 'Phone Review',
          slug: 'phone-review',
          content: '<p>Full review</p>',
          excerpt: 'Quick summary',
          featured_image_url: null,
          category: 'Reviews',
          author_name: 'Bassey John',
          published_at: '2026-04-01T10:00:00.000Z',
          updated_at: '2026-04-01T10:00:00.000Z',
        },
      ],
    });

    expect(xml).toContain('https://ogabassey.com/blog/phone-review');
    expect(xml).toContain('Phone Review');

    const fallbackXml = buildBlogRssFeedXml({
      baseUrl: 'https://usebaci.com',
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Ogabassey',
        site_description: null,
        logo_url: null,
        custom_domain: 'invalid domain with spaces',
      },
      posts: [],
    });

    expect(fallbackXml).toContain('https://usebaci.com/ogabassey/blog');
  });

  it('omits RSS enclosure when image MIME type is indeterminate', () => {
    const xml = buildBlogRssFeedXml({
      baseUrl: 'https://usebaci.com',
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        business_name: 'Ogabassey',
        site_description: null,
        logo_url: null,
      },
      posts: [
        {
          id: 'extensionless-image-post',
          title: 'Accessory Guide',
          slug: 'accessory-guide',
          content: '<p>Guide body.</p>',
          excerpt: 'Guide excerpt',
          featured_image_url:
            'https://cdn.example.com/cdn-cgi/image/width=800,format=auto/cell',
          category: 'Accessories',
          author_name: 'Ogabassey',
          published_at: '2026-05-01T10:00:00.000Z',
          updated_at: null,
        },
      ],
    });

    expect(xml).not.toContain('<enclosure');
  });
});
