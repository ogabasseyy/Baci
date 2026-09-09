import { afterEach, describe, expect, it, vi } from 'vitest';
import { ogabasseyCwvNetwork } from './measure-ogabassey-cwv-network-utils.mjs';

const { fetchJson, resolveCanonicalUrl, resolveLatestBlogPostUrl } =
  ogabasseyCwvNetwork;

describe('fetchJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws the HTTP status and body before parsing non-JSON errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        text: async () => '<html>Service unavailable</html>',
      }))
    );

    await expect(fetchJson('https://example.com/api')).rejects.toThrow(
      'https://example.com/api failed with 503: <html>Service unavailable</html>'
    );
  });

  it('redacts PageSpeed keys from error URLs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => 'quota exceeded',
      }))
    );

    await expect(
      fetchJson('https://example.com/api?url=https://x.test&key=secret')
    ).rejects.toThrow(
      'https://example.com/api?url=https%3A%2F%2Fx.test&key=REDACTED failed with 403: quota exceeded'
    );
  });

  it('redacts secret query params regardless of casing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => 'quota exceeded',
      }))
    );

    await expect(
      fetchJson(
        'https://example.com/api?url=https://x.test&KEY=secret&Api_Key=secret2&TOKEN=secret3'
      )
    ).rejects.toThrow(
      'https://example.com/api?url=https%3A%2F%2Fx.test&KEY=REDACTED&Api_Key=REDACTED&TOKEN=REDACTED failed with 403: quota exceeded'
    );
  });

  it('parses successful JSON responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => '{"ok":true}',
      }))
    );

    await expect(fetchJson('https://example.com/api')).resolves.toEqual({
      ok: true,
    });
  });
});

describe('resolveLatestBlogPostUrl', () => {
  afterEach(() => {
    delete process.env.OGABASSEY_BLOG_POST_URL;
    vi.unstubAllGlobals();
  });

  it('uses an explicit blog post URL override', async () => {
    process.env.OGABASSEY_BLOG_POST_URL = 'https://ogabassey.com/blog/manual';

    await expect(
      resolveLatestBlogPostUrl('https://ogabassey.com/blog')
    ).resolves.toBe('https://ogabassey.com/blog/manual');
  });

  it('treats blank explicit blog post overrides as unset', async () => {
    process.env.OGABASSEY_BLOG_POST_URL = '   ';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => '<a href="/blog/post?utm=1#top"></a>',
      }))
    );

    await expect(
      resolveLatestBlogPostUrl('https://ogabassey.com/blog')
    ).resolves.toBe('https://ogabassey.com/blog/post');
  });

  it('skips malformed hrefs and returns the first same-origin blog post', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          '<a href="https://["></a><a href="/blog/post?utm=1#top"></a>',
      }))
    );

    await expect(
      resolveLatestBlogPostUrl('https://ogabassey.com/blog')
    ).resolves.toBe('https://ogabassey.com/blog/post');
  });

  it('accepts slug-prefixed path-mode blog post links', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => '<a href="/ogabassey/blog/post?utm=1"></a>',
      }))
    );

    await expect(
      resolveLatestBlogPostUrl('https://usebaci.com/ogabassey/blog')
    ).resolves.toBe('https://usebaci.com/ogabassey/blog/post');
  });

  it('rejects cross-tenant path-mode blog links before selecting latest post', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          '<a href="/blog/wrong"></a><a href="/other/blog/wrong"></a><a href="/ogabassey/blog/right"></a>',
      }))
    );

    await expect(
      resolveLatestBlogPostUrl('https://usebaci.com/ogabassey/blog')
    ).resolves.toBe('https://usebaci.com/ogabassey/blog/right');
  });

  it('ignores feed, API, and sitemap blog links before selecting an article', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          [
            '<a href="/api/blog/feed/ogabassey"></a>',
            '<a href="/blog/feed"></a>',
            '<a href="/blog/sitemap.xml"></a>',
            '<a href="/blog/article-slug?utm=1"></a>',
          ].join(''),
      }))
    );

    await expect(
      resolveLatestBlogPostUrl('https://ogabassey.com/blog')
    ).resolves.toBe('https://ogabassey.com/blog/article-slug');
  });

  it('returns null when the blog index cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('network down');
      })
    );

    await expect(
      resolveLatestBlogPostUrl('https://ogabassey.com/blog')
    ).resolves.toBeNull();
  });
});

describe('resolveCanonicalUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves requested PDP query parameters when the canonical path matches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          '<link rel="canonical" href="/products/source?utm=1#top">',
        url: 'https://ogabassey.com/products/source?variant=blue',
      }))
    );

    await expect(
      resolveCanonicalUrl('https://ogabassey.com/products/source?variant=blue')
    ).resolves.toBe('https://ogabassey.com/products/source?variant=blue');
  });

  it('parses canonical links when href appears before rel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          '<link href="/products/source?utm=1#top" rel="canonical">',
        url: 'https://ogabassey.com/products/source',
      }))
    );

    await expect(
      resolveCanonicalUrl('https://ogabassey.com/products/source?variant=red')
    ).resolves.toBe('https://ogabassey.com/products/source?variant=red');
  });

  it('fails PDP resolution on non-OK responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        text: async () => 'missing',
        url: 'https://ogabassey.com/products/source',
      }))
    );

    await expect(
      resolveCanonicalUrl('https://ogabassey.com/products/source')
    ).rejects.toThrow('PDP canonical resolution failed');
  });

  it('rejects redirects before auditing the PDP target', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => '<html></html>',
        url: 'https://ogabassey.com/',
      }))
    );

    await expect(
      resolveCanonicalUrl('https://ogabassey.com/products/source')
    ).rejects.toThrow('changed path from /products/source to /');
  });

  it('rejects canonical tags that point at another path or origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          '<link rel="canonical" href="https://evil.example/products/canonical">',
        url: 'https://ogabassey.com/products/source',
      }))
    );

    await expect(
      resolveCanonicalUrl('https://ogabassey.com/products/source')
    ).rejects.toThrow('changed origin');
  });
});
