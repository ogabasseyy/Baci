import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import { isTrustedManagedBlogImageUrl } from './is-trusted-managed-blog-image-url';

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
