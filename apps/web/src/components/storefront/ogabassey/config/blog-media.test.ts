import { describe, expect, it } from 'vitest';
import {
  BLOG_HERO_IMAGE_QUALITY,
  BLOG_LISTING_CARD_IMAGE_SIZES,
  BLOG_LISTING_FEATURED_IMAGE_PRELOAD_WIDTH,
  BLOG_LISTING_FEATURED_IMAGE_SIZES,
  BLOG_POST_HERO_IMAGE_PRELOAD_WIDTH,
  BLOG_POST_HERO_IMAGE_SIZES,
} from './blog-media';

// The `qualities` allowlist next/image validates against at build time. Source of
// truth: `images.qualities` in apps/web/next.config.ts — keep this array in sync
// with it (importing next.config.ts into Vitest is fragile, so it is mirrored).
const NEXT_IMAGE_QUALITIES = [35, 50, 60, 70, 75, 80, 85, 90, 100];

describe('blog media config', () => {
  it('pins the shared blog hero quality to a lighter-than-default value', () => {
    // Default next/image quality is 75; the shared blog quality must be lower
    // to cut hero bytes on the measured Slow-4G LCP.
    expect(BLOG_HERO_IMAGE_QUALITY).toBe(50);
    expect(BLOG_HERO_IMAGE_QUALITY).toBeLessThan(75);
  });

  it('keeps the shared quality inside the next/image qualities allowlist', () => {
    // An off-list quality makes next/image throw at build, so guard it here.
    expect(NEXT_IMAGE_QUALITIES).toContain(BLOG_HERO_IMAGE_QUALITY);
  });

  it('exposes responsive sizes for the blog post hero matching article padding', () => {
    expect(BLOG_POST_HERO_IMAGE_SIZES).toContain('calc(100vw - 80px)');
    expect(BLOG_POST_HERO_IMAGE_SIZES).toContain('1056px');
    expect(BLOG_POST_HERO_IMAGE_PRELOAD_WIDTH).toBe(1200);
  });

  it('exposes responsive listing hero sizes and a responsive card sizes value', () => {
    expect(BLOG_LISTING_FEATURED_IMAGE_SIZES).toContain('calc(100vw - 2rem)');
    expect(BLOG_LISTING_FEATURED_IMAGE_SIZES).toContain('1400px');
    expect(BLOG_LISTING_FEATURED_IMAGE_PRELOAD_WIDTH).toBe(750);
    expect(BLOG_LISTING_CARD_IMAGE_SIZES).toContain('33vw');
  });
});
