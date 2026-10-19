import { afterEach, describe, expect, it } from 'vitest';
import { getTrustedBlogMediaTransformProjection } from '@/lib/get-trusted-blog-media-transform-projection';

const ORIGINAL_BLOG_MEDIA_ORIGIN =
  process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN;

afterEach(() => {
  if (ORIGINAL_BLOG_MEDIA_ORIGIN === undefined) {
    delete process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN;
    return;
  }
  process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN = ORIGINAL_BLOG_MEDIA_ORIGIN;
});

describe('getTrustedBlogMediaTransformProjection', () => {
  it('parses dimensions, aliases, format, and fit on a configured origin', () => {
    process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN = 'https://media.example.com';

    const projection = getTrustedBlogMediaTransformProjection(
      'https://media.example.com/image/w=600,h=300,f=webp,fit=cover/media/photo.jpg'
    );

    expect(projection).toEqual({
      fit: 'cover',
      type: 'image/webp',
      width: 600,
      height: 300,
    });
  });

  it('keeps auto transforms recognizable without claiming a MIME type', () => {
    const projection = getTrustedBlogMediaTransformProjection(
      'https://cdn.ogabassey.com/image/width=600/media/photo.jpg'
    );

    expect(projection).toEqual({ fit: 'inside', width: 600 });
  });

  it('uses non-empty dimension aliases when long-form options are empty', () => {
    const projection = getTrustedBlogMediaTransformProjection(
      'https://cdn.ogabassey.com/image/width=,w=600,height=,h=300,format=webp/media/photo.jpg'
    );

    expect(projection).toEqual({
      fit: 'inside',
      type: 'image/webp',
      width: 600,
      height: 300,
    });
  });

  it('rejects transform syntax on an unconfigured origin', () => {
    const projection = getTrustedBlogMediaTransformProjection(
      'https://example.com/image/format=jpeg/login'
    );

    expect(projection).toBeUndefined();
  });

  it('rejects direct image paths without a transform options segment', () => {
    const projection = getTrustedBlogMediaTransformProjection(
      'https://cdn.ogabassey.com/image/photo.jpg'
    );

    expect(projection).toBeUndefined();
  });

  it.each([
    'photo.gif',
    'photo',
  ])('rejects the unsupported transform source %s', (sourceName) => {
    const projection = getTrustedBlogMediaTransformProjection(
      `https://cdn.ogabassey.com/image/format=jpeg/media/${sourceName}`
    );

    expect(projection).toBeUndefined();
  });

  it('rejects a decoded parent traversal source path', () => {
    const projection = getTrustedBlogMediaTransformProjection(
      'https://cdn.ogabassey.com/image/format=jpeg/%2e%2e%2foutside.jpg'
    );

    expect(projection).toBeUndefined();
  });
});
