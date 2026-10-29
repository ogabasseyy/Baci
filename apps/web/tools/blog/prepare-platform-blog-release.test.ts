import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '../../src/config/cdn';
import { preparePlatformBlogRelease } from './prepare-platform-blog-release';

const handoff = {
  schema_version: 'baci-blog-review-handoff/v1',
  title: 'Baci comparison',
  slug: 'baci-comparison',
  content_html: '<p>A reviewed comparison for Nigerian businesses.</p>',
  featured_image: {
    url: `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/media/platform/blog/cover.webp`,
    alt: 'Two selling workflows compared',
    width: 1200,
    height: 675,
    variants: {
      landscape_16x9: `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/media/platform/blog/cover/landscape_16x9.webp`,
    },
  },
};

describe('preparePlatformBlogRelease', () => {
  it('requires publication readiness before approving a release', () => {
    expect(() =>
      preparePlatformBlogRelease({
        ...handoff,
        featured_image: { ...handoff.featured_image, width: 600 },
      })
    ).toThrow('BLOG_FEATURED_IMAGE_NOT_DISCOVER_READY');
  });
  it('prepares published metadata and preserves reviewed alt text', () => {
    const result = preparePlatformBlogRelease(handoff);
    expect(result).toMatchObject({
      status: 'published',
      featured_image_alt: handoff.featured_image.alt,
      reading_time_minutes: 1,
      word_count: 6,
    });
    expect(result).not.toHaveProperty('featured_image_alt_edited');
    expect(result).not.toHaveProperty('merchant_id');
  });
  it('sanitizes unsafe HTML before preparing approval', () => {
    const result = preparePlatformBlogRelease({
      ...handoff,
      content_html: '<p>Reviewed article</p><script>alert(1)</script>',
    });
    expect(result.content).not.toContain('<script');
  });
  it('rejects invalid save-limited fields', () => {
    expect(() =>
      preparePlatformBlogRelease({ ...handoff, title: 'x'.repeat(201) })
    ).toThrow();
  });
});
