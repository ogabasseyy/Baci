import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import { isTrustedGeneratedCodexBlogImageUrl } from './is-trusted-generated-codex-blog-image-url';

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
