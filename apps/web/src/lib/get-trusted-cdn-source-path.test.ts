import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import { getTrustedCdnSourcePath } from './get-trusted-cdn-source-path';

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
    `${trustedOrigin}/image//core-assets/blog/codex/run/cover.jpg`,
    'https://evil.example.com/media/a.png',
    'http://cdn.example.com/media/a.png',
    'not a url',
    '',
  ])('returns null without a trusted source path: %s', (value) => {
    expect(getTrustedCdnSourcePath(value)).toBeNull();
  });
});
