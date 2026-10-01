import { describe, expect, it } from 'vitest';
import { getBlogAuthorSlugs } from './blog-authors';
import { buildStorefrontBlogPurgeUrls } from './storefront-purge-urls';

// Author hub pages are emitted for every registered author slug on every
// resolved hostname (see buildStorefrontBlogPurgeUrls). These are the two
// static, ogabassey-gated registry slugs, appended AFTER the /blog, per-post,
// and per-category URLs for each hostname.
const AUTHOR_SLUGS = getBlogAuthorSlugs();

function authorUrls(hostname: string): string[] {
  return AUTHOR_SLUGS.map((slug) => `https://${hostname}/blog/author/${slug}`);
}

describe('buildStorefrontBlogPurgeUrls', () => {
  it('purges each post compatibility image alongside its blog page', () => {
    const urls = buildStorefrontBlogPurgeUrls(['ogabassey'], ['post-a']);

    expect(urls).toContain('https://ogabassey.com/blog/post-a/opengraph-image');
    expect(urls).toContain(
      'https://www.ogabassey.com/blog/post-a/opengraph-image'
    );
  });

  it('builds /blog, per-post, and author-hub URLs for every custom hostname of a matched slug', () => {
    const urls = buildStorefrontBlogPurgeUrls(['ogabassey'], ['post-a']);

    expect(urls).toEqual([
      'https://ogabassey.com/blog',
      'https://ogabassey.com/blog/news-sitemap.xml',
      'https://ogabassey.com/blog/sitemap.xml',
      'https://ogabassey.com/blog/post-a',
      'https://ogabassey.com/blog/post-a/opengraph-image',
      ...authorUrls('ogabassey.com'),
      'https://www.ogabassey.com/blog',
      'https://www.ogabassey.com/blog/news-sitemap.xml',
      'https://www.ogabassey.com/blog/sitemap.xml',
      'https://www.ogabassey.com/blog/post-a',
      'https://www.ogabassey.com/blog/post-a/opengraph-image',
      ...authorUrls('www.ogabassey.com'),
    ]);
  });

  it('resolves the policy when the identifier is a custom hostname', () => {
    const urls = buildStorefrontBlogPurgeUrls(['ogabassey.com'], []);

    expect(urls).toContain('https://ogabassey.com/blog');
    expect(urls).toContain('https://www.ogabassey.com/blog');
  });

  it('emits an author-hub URL per registered author on every resolved hostname', () => {
    const urls = buildStorefrontBlogPurgeUrls(['ogabassey'], []);

    // Author hubs list a byline's posts, so any post mutation can change them —
    // they are always evicted alongside /blog. Slugs come from the registry.
    expect(AUTHOR_SLUGS.length).toBeGreaterThan(0);
    for (const slug of AUTHOR_SLUGS) {
      expect(urls).toContain(`https://ogabassey.com/blog/author/${slug}`);
      expect(urls).toContain(`https://www.ogabassey.com/blog/author/${slug}`);
    }
  });

  it('returns an empty list for storefronts without a public cache policy', () => {
    expect(buildStorefrontBlogPurgeUrls(['unknown-store'], ['post-a'])).toEqual(
      []
    );
  });

  it('returns an empty list when there are no identifiers', () => {
    expect(buildStorefrontBlogPurgeUrls([], ['post-a'])).toEqual([]);
  });

  it('preserves the original slug casing in the purge URL (CDN paths are case-sensitive)', () => {
    const urls = buildStorefrontBlogPurgeUrls(
      ['ogabassey'],
      ['Best-Phones-2026']
    );

    // The slug must NOT be lowercased — purging /blog/best-phones-2026 would miss
    // the actually-cached mixed-case /blog/Best-Phones-2026 entry.
    expect(urls).toEqual([
      'https://ogabassey.com/blog',
      'https://ogabassey.com/blog/news-sitemap.xml',
      'https://ogabassey.com/blog/sitemap.xml',
      'https://ogabassey.com/blog/Best-Phones-2026',
      'https://ogabassey.com/blog/Best-Phones-2026/opengraph-image',
      ...authorUrls('ogabassey.com'),
      'https://www.ogabassey.com/blog',
      'https://www.ogabassey.com/blog/news-sitemap.xml',
      'https://www.ogabassey.com/blog/sitemap.xml',
      'https://www.ogabassey.com/blog/Best-Phones-2026',
      'https://www.ogabassey.com/blog/Best-Phones-2026/opengraph-image',
      ...authorUrls('www.ogabassey.com'),
    ]);
  });

  it('deduplicates URLs and skips blank slugs', () => {
    const urls = buildStorefrontBlogPurgeUrls(
      ['ogabassey', 'ogabassey.com'],
      ['post-a', '  ', 'post-a']
    );

    // ogabassey (slug) and ogabassey.com (hostname) resolve to the same policy,
    // so the hostname set is emitted once; the blank slug is dropped.
    expect(urls).toEqual([
      'https://ogabassey.com/blog',
      'https://ogabassey.com/blog/news-sitemap.xml',
      'https://ogabassey.com/blog/sitemap.xml',
      'https://ogabassey.com/blog/post-a',
      'https://ogabassey.com/blog/post-a/opengraph-image',
      ...authorUrls('ogabassey.com'),
      'https://www.ogabassey.com/blog',
      'https://www.ogabassey.com/blog/news-sitemap.xml',
      'https://www.ogabassey.com/blog/sitemap.xml',
      'https://www.ogabassey.com/blog/post-a',
      'https://www.ogabassey.com/blog/post-a/opengraph-image',
      ...authorUrls('www.ogabassey.com'),
    ]);
  });

  it('emits /blog/category/<slug> for each affected category on every hostname', () => {
    const urls = buildStorefrontBlogPurgeUrls(
      ['ogabassey'],
      ['post-a'],
      ['buying-guides', 'reviews']
    );

    expect(urls).toEqual([
      'https://ogabassey.com/blog',
      'https://ogabassey.com/blog/news-sitemap.xml',
      'https://ogabassey.com/blog/sitemap.xml',
      'https://ogabassey.com/blog/post-a',
      'https://ogabassey.com/blog/post-a/opengraph-image',
      'https://ogabassey.com/blog/category/buying-guides',
      'https://ogabassey.com/blog/category/reviews',
      ...authorUrls('ogabassey.com'),
      'https://www.ogabassey.com/blog',
      'https://www.ogabassey.com/blog/news-sitemap.xml',
      'https://www.ogabassey.com/blog/sitemap.xml',
      'https://www.ogabassey.com/blog/post-a',
      'https://www.ogabassey.com/blog/post-a/opengraph-image',
      'https://www.ogabassey.com/blog/category/buying-guides',
      'https://www.ogabassey.com/blog/category/reviews',
      ...authorUrls('www.ogabassey.com'),
    ]);
  });

  it('emits category listing URLs even when there are no post slugs', () => {
    const urls = buildStorefrontBlogPurgeUrls(['ogabassey'], [], ['reviews']);

    expect(urls).toEqual([
      'https://ogabassey.com/blog',
      'https://ogabassey.com/blog/news-sitemap.xml',
      'https://ogabassey.com/blog/sitemap.xml',
      'https://ogabassey.com/blog/category/reviews',
      ...authorUrls('ogabassey.com'),
      'https://www.ogabassey.com/blog',
      'https://www.ogabassey.com/blog/news-sitemap.xml',
      'https://www.ogabassey.com/blog/sitemap.xml',
      'https://www.ogabassey.com/blog/category/reviews',
      ...authorUrls('www.ogabassey.com'),
    ]);
  });

  it('dedupes category slugs and preserves the original path casing', () => {
    const urls = buildStorefrontBlogPurgeUrls(
      ['ogabassey'],
      [],
      ['Reviews', '  ', 'Reviews']
    );

    // The CDN path is case-sensitive, so the slug casing is preserved and only
    // normalized duplicates / blanks are dropped.
    expect(urls).toEqual([
      'https://ogabassey.com/blog',
      'https://ogabassey.com/blog/news-sitemap.xml',
      'https://ogabassey.com/blog/sitemap.xml',
      'https://ogabassey.com/blog/category/Reviews',
      ...authorUrls('ogabassey.com'),
      'https://www.ogabassey.com/blog',
      'https://www.ogabassey.com/blog/news-sitemap.xml',
      'https://www.ogabassey.com/blog/sitemap.xml',
      'https://www.ogabassey.com/blog/category/Reviews',
      ...authorUrls('www.ogabassey.com'),
    ]);
  });
});
