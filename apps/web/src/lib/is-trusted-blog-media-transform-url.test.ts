import { afterEach, describe, expect, it } from 'vitest';
import { isTrustedBlogMediaTransformUrl } from '@/lib/is-trusted-blog-media-transform-url';

const ORIGINAL_BLOG_MEDIA_ORIGIN =
  process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN;

afterEach(() => {
  if (ORIGINAL_BLOG_MEDIA_ORIGIN === undefined) {
    delete process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN;
    return;
  }
  process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN = ORIGINAL_BLOG_MEDIA_ORIGIN;
});

describe('isTrustedBlogMediaTransformUrl', () => {
  it('recognizes transform syntax on the default media origin', () => {
    const result = isTrustedBlogMediaTransformUrl(
      'https://cdn.ogabassey.com/image/format=jpeg/media/cover.jpg'
    );

    expect(result).toBe(true);
  });

  it('recognizes a transformer route with an empty options segment', () => {
    const result = isTrustedBlogMediaTransformUrl(
      'https://cdn.ogabassey.com/image//media/cover.jpg'
    );

    expect(result).toBe(true);
  });

  it('recognizes a transformer route without an options or source separator', () => {
    const result = isTrustedBlogMediaTransformUrl(
      'https://cdn.ogabassey.com/image/card.jpg'
    );

    expect(result).toBe(true);
  });

  it('recognizes transform syntax on a configured media origin', () => {
    process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN = 'https://media.example.com';

    const result = isTrustedBlogMediaTransformUrl(
      'https://media.example.com/image/format=webp/media/cover.jpg'
    );

    expect(result).toBe(true);
  });

  it.each([
    'https://example.com/image/format=jpeg/media/cover.jpg',
    'http://cdn.ogabassey.com/image/format=jpeg/media/cover.jpg',
  ])('rejects the non-trusted transform candidate %s', (url) => {
    const result = isTrustedBlogMediaTransformUrl(url);

    expect(result).toBe(false);
  });
});
