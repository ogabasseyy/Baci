import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import {
  getTrustedCdnSourcePath,
  isBlogFeaturedVariantKey,
  isTrustedGeneratedCodexBlogImageUrl,
  isTrustedGeneratedCodexBlogVariantUrl,
  isTrustedManagedBlogImageUrl,
} from './blog-image-url-identity';

// Mirror the module's trusted-origin resolution so positives hold
// whether or not the test environment overrides the CDN origin.
const trustedOrigin = (() => {
  try {
    return new URL(
      process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN ||
        DEFAULT_BLOG_MEDIA_CDN_ORIGIN
    ).origin;
  } catch {
    return new URL(DEFAULT_BLOG_MEDIA_CDN_ORIGIN).origin;
  }
})();

describe('isBlogFeaturedVariantKey', () => {
  it.each([
    'landscape_16x9',
    'standard_4x3',
    'square_1x1',
  ])('accepts the known variant key: %s', (value) => {
    expect(isBlogFeaturedVariantKey(value)).toBe(true);
  });

  it.each([
    'thumb',
    '',
    'LANDSCAPE_16X9',
    'landscape-16x9',
  ])('rejects unknown variant keys: %s', (value) => {
    expect(isBlogFeaturedVariantKey(value)).toBe(false);
  });
});

describe('isTrustedManagedBlogImageUrl', () => {
  it('accepts HTTPS URLs on a trusted origin', () => {
    expect(
      isTrustedManagedBlogImageUrl(
        `${trustedOrigin}/media/platform/blog/cover.webp`
      )
    ).toBe(true);
  });

  it.each([
    'http://cdn.example.com/media/platform/blog/cover.webp',
    'https://evil.example.com/media/platform/blog/cover.webp',
    'not a url',
    '',
    '/media/platform/blog/cover.webp',
  ])('rejects untrusted or malformed URLs: %s', (value) => {
    expect(isTrustedManagedBlogImageUrl(value)).toBe(false);
  });
});

describe('getTrustedCdnSourcePath', () => {
  it('returns plain trusted paths unchanged', () => {
    expect(
      getTrustedCdnSourcePath(`${trustedOrigin}/media/platform/blog/cover.webp`)
    ).toBe('/media/platform/blog/cover.webp');
  });

  it('strips one transform segment from CDN image URLs', () => {
    expect(
      getTrustedCdnSourcePath(
        `${trustedOrigin}/image/format=auto/core-assets/blog/codex/dir/name.png`
      )
    ).toBe('/core-assets/blog/codex/dir/name.png');
    expect(
      getTrustedCdnSourcePath(
        `${trustedOrigin}/image/w=100,format=auto/foo/bar.png`
      )
    ).toBe('/foo/bar.png');
  });

  it('decodes percent-encoded paths', () => {
    expect(getTrustedCdnSourcePath(`${trustedOrigin}/media/a%20b.png`)).toBe(
      '/media/a b.png'
    );
  });

  it.each([
    `${trustedOrigin}/image/`,
    `${trustedOrigin}/image/format=auto`,
    'https://evil.example.com/media/a.png',
    'http://cdn.example.com/media/a.png',
    'not a url',
    '',
  ])('returns null without a trusted source path: %s', (value) => {
    expect(getTrustedCdnSourcePath(value)).toBeNull();
  });
});

describe('isTrustedGeneratedCodexBlogImageUrl', () => {
  it.each([
    'avif',
    'jpg',
    'jpeg',
    'png',
    'webp',
    'JPG',
  ])('accepts generated codex images with renderable extensions: %s', (extension) => {
    expect(
      isTrustedGeneratedCodexBlogImageUrl(
        `${trustedOrigin}/core-assets/blog/codex/dir/name.${extension}`
      )
    ).toBe(true);
  });

  it('accepts generated codex images behind a transform segment', () => {
    expect(
      isTrustedGeneratedCodexBlogImageUrl(
        `${trustedOrigin}/image/format=auto/core-assets/blog/codex/dir/name.png`
      )
    ).toBe(true);
  });

  it.each([
    `${trustedOrigin}/core-assets/blog/other/name.jpg`,
    `${trustedOrigin}/core-assets/blog/codex/../name.jpg`,
    `${trustedOrigin}/core-assets/blog/codex/dir/name.gif`,
    `${trustedOrigin}/core-assets/blog/codex/dir/name`,
    'https://evil.example.com/core-assets/blog/codex/dir/name.jpg',
    'not a url',
  ])('rejects non-generated image URLs: %s', (value) => {
    expect(isTrustedGeneratedCodexBlogImageUrl(value)).toBe(false);
  });
});

describe('isTrustedGeneratedCodexBlogVariantUrl', () => {
  it('accepts exact and suffixed variant filenames', () => {
    expect(
      isTrustedGeneratedCodexBlogVariantUrl(
        `${trustedOrigin}/core-assets/blog/codex/dir/landscape_16x9.jpg`,
        'landscape_16x9'
      )
    ).toBe(true);
    expect(
      isTrustedGeneratedCodexBlogVariantUrl(
        `${trustedOrigin}/core-assets/blog/codex/dir/cover-standard_4x3.jpeg`,
        'standard_4x3'
      )
    ).toBe(true);
  });

  it('matches variant filenames case-insensitively', () => {
    expect(
      isTrustedGeneratedCodexBlogVariantUrl(
        `${trustedOrigin}/core-assets/blog/codex/dir/COVER-SQUARE_1X1.AVIF`,
        'square_1x1'
      )
    ).toBe(true);
  });

  it.each([
    `${trustedOrigin}/core-assets/blog/codex/dir/cover-standard_4x3.jpg`,
    `${trustedOrigin}/core-assets/blog/codex/dir/cover.jpg`,
    `${trustedOrigin}/core-assets/blog/codex/dir/landscape_16x9.gif`,
    `${trustedOrigin}/core-assets/blog/other/cover-landscape_16x9.jpg`,
    `${trustedOrigin}/core-assets/blog/codex/../cover-landscape_16x9.jpg`,
    'https://evil.example.com/core-assets/blog/codex/dir/cover-landscape_16x9.jpg',
  ])('rejects mismatched variant URLs: %s', (value) => {
    expect(isTrustedGeneratedCodexBlogVariantUrl(value, 'landscape_16x9')).toBe(
      false
    );
  });
});
