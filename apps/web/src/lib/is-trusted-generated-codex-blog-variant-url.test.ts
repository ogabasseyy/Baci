import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import { isTrustedGeneratedCodexBlogVariantUrl } from './is-trusted-generated-codex-blog-variant-url';

// Mirror the trusted-origin resolution so positives hold whether or
// not the test environment overrides the CDN origin.
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
