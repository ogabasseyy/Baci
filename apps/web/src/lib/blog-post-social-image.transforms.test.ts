import { afterEach, describe, expect, it } from 'vitest';
import { getBlogPostSocialImage } from '@/lib/blog-post-social-image';

const STORE_URL = 'https://ogabassey.com';
const POST_SLUG = 'pixel-11-review';
const ORIGINAL_BLOG_MEDIA_ORIGIN =
  process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN;

afterEach(() => {
  if (ORIGINAL_BLOG_MEDIA_ORIGIN === undefined) {
    delete process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN;
    return;
  }
  process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN = ORIGINAL_BLOG_MEDIA_ORIGIN;
});

describe('blog post social image transform projection', () => {
  it('does not publish format=auto from a configured media origin', () => {
    process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN = 'https://media.example.com';

    const image = getBlogPostSocialImage(STORE_URL, POST_SLUG, null, {
      landscape_16x9:
        'https://media.example.com/image/format=auto/core-assets/blog/pixel-11-landscape_16x9.jpg',
    });

    expect(image).toEqual({
      url: 'https://ogabassey.com/blog/pixel-11-review/opengraph-image',
      width: 1200,
      height: 630,
      type: 'image/png',
    });
  });

  it('reports the rendered width of an already-transformed landscape variant', () => {
    const transformedUrl =
      'https://cdn.ogabassey.com/image/width=600,format=webp/media/merchant-1/blog/upload/landscape_16x9.webp';

    const image = getBlogPostSocialImage(STORE_URL, POST_SLUG, transformedUrl, {
      landscape_16x9: transformedUrl,
    });

    expect(image).toEqual({
      url: transformedUrl,
      width: 600,
      height: 338,
      type: 'image/webp',
    });
  });

  it('uses fixed format and width projections on a configured media origin', () => {
    process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN = 'https://media.example.com';
    const transformedUrl =
      'https://media.example.com/image/width=600,format=webp/core-assets/blog/pixel-11-landscape_16x9.jpg';

    const image = getBlogPostSocialImage(STORE_URL, POST_SLUG, null, {
      landscape_16x9: transformedUrl,
    });

    expect(image).toEqual({
      url: transformedUrl,
      width: 600,
      height: 338,
      type: 'image/webp',
    });
  });

  it.each([
    'http://cdn.ogabassey.com/core-assets/blog/card.jpg',
    'https://cdn.ogabassey.com:444/core-assets/blog/card.jpg',
  ])('falls back for a managed hostname on an unapproved origin: %s', (url) => {
    const image = getBlogPostSocialImage(
      STORE_URL,
      POST_SLUG,
      url,
      {},
      1600,
      900
    );

    expect(image).toEqual({
      url: 'https://ogabassey.com/blog/pixel-11-review/opengraph-image',
      width: 1200,
      height: 630,
      type: 'image/png',
    });
  });

  it('keeps an ordinary direct image whose path begins with image', () => {
    const image = getBlogPostSocialImage(
      STORE_URL,
      POST_SLUG,
      'https://images.example.com/image/photo.jpg',
      {}
    );

    expect(image).toEqual({
      url: 'https://images.example.com/image/photo.jpg',
      type: 'image/jpeg',
    });
  });

  it('rejects a fixed-format transform with an unsupported source path', () => {
    process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN = 'https://media.example.com';
    const transformedUrl =
      'https://media.example.com/image/width=600,format=webp/media/photo.gif';

    const image = getBlogPostSocialImage(
      STORE_URL,
      POST_SLUG,
      transformedUrl,
      {},
      1200,
      675
    );

    expect(image).toEqual({
      url: 'https://ogabassey.com/blog/pixel-11-review/opengraph-image',
      width: 1200,
      height: 630,
      type: 'image/png',
    });
  });

  it('rejects an unchanged auto transform on the default CDN media path', () => {
    const transformedUrl =
      'https://cdn.ogabassey.com/image/width=600,format=auto/media/merchant-1/blog/upload/landscape_16x9.jpg';

    const image = getBlogPostSocialImage(STORE_URL, POST_SLUG, transformedUrl, {
      landscape_16x9: transformedUrl,
    });

    expect(image).toEqual({
      url: 'https://ogabassey.com/blog/pixel-11-review/opengraph-image',
      width: 1200,
      height: 630,
      type: 'image/png',
    });
  });

  it('falls back when a trusted transform fails projection validation', () => {
    const transformedUrl =
      'https://cdn.ogabassey.com/image/format=jpeg/media/x/%2e%2e%2flandscape_16x9.jpg';

    const image = getBlogPostSocialImage(STORE_URL, POST_SLUG, transformedUrl, {
      landscape_16x9: transformedUrl,
    });

    expect(image).toEqual({
      url: 'https://ogabassey.com/blog/pixel-11-review/opengraph-image',
      width: 1200,
      height: 630,
      type: 'image/png',
    });
  });

  it('falls back for a managed transform with empty auto options', () => {
    const transformedUrl =
      'https://cdn.ogabassey.com/image//media/landscape_16x9.jpg';

    const image = getBlogPostSocialImage(STORE_URL, POST_SLUG, transformedUrl, {
      landscape_16x9: transformedUrl,
    });

    expect(image).toEqual({
      url: 'https://ogabassey.com/blog/pixel-11-review/opengraph-image',
      width: 1200,
      height: 630,
      type: 'image/png',
    });
  });

  it('falls back when a trusted transformer route omits its options and source separator', () => {
    const transformedUrl = 'https://cdn.ogabassey.com/image/card.jpg';

    const image = getBlogPostSocialImage(
      STORE_URL,
      POST_SLUG,
      transformedUrl,
      {}
    );

    expect(image).toEqual({
      url: 'https://ogabassey.com/blog/pixel-11-review/opengraph-image',
      width: 1200,
      height: 630,
      type: 'image/png',
    });
  });

  it('rejects transform syntax from an unconfigured origin', () => {
    const image = getBlogPostSocialImage(
      STORE_URL,
      POST_SLUG,
      'https://example.com/image/format=jpeg/login',
      {},
      1200,
      675
    );

    expect(image).toEqual({
      url: 'https://ogabassey.com/blog/pixel-11-review/opengraph-image',
      width: 1200,
      height: 630,
      type: 'image/png',
    });
  });

  it('projects a height-constrained landscape transform', () => {
    const transformedUrl =
      'https://cdn.ogabassey.com/image/height=300,format=webp/media/merchant-1/blog/upload/landscape_16x9.webp';

    const image = getBlogPostSocialImage(STORE_URL, POST_SLUG, transformedUrl, {
      landscape_16x9: transformedUrl,
    });

    expect(image).toEqual({
      url: transformedUrl,
      width: 533,
      height: 300,
      type: 'image/webp',
    });
  });

  it.each([
    ['inside', 533, 300],
    ['cover', 600, 300],
  ] as const)('projects a width-and-height transform using %s fit', (fit, width, height) => {
    const transformedUrl = `https://cdn.ogabassey.com/image/width=600,height=300,fit=${fit},format=webp/media/merchant-1/blog/upload/landscape_16x9.webp`;

    const image = getBlogPostSocialImage(STORE_URL, POST_SLUG, transformedUrl, {
      landscape_16x9: transformedUrl,
    });

    expect(image).toEqual({
      url: transformedUrl,
      width,
      height,
      type: 'image/webp',
    });
  });
});
