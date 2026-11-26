import { describe, expect, it } from 'vitest';
import {
  BLOG_HERO_IMAGE_QUALITY,
  BLOG_LISTING_CARD_IMAGE_SIZES,
  BLOG_LISTING_CARD_MAX_SRCSET_WIDTH,
  BLOG_LISTING_CARD_MIN_SRCSET_WIDTH,
  BLOG_LISTING_FEATURED_IMAGE_PRELOAD_WIDTH,
  BLOG_LISTING_FEATURED_IMAGE_SIZES,
  BLOG_POST_HERO_IMAGE_PRELOAD_WIDTH,
  BLOG_POST_HERO_IMAGE_SIZES,
} from './blog-media';

// The `qualities` allowlist next/image validates against at build time. Source of
// truth: `images.qualities` in apps/web/next.config.ts — keep this array in sync
// with it (importing next.config.ts into Vitest is fragile, so it is mirrored).
const NEXT_IMAGE_QUALITIES = [35, 50, 60, 70, 75, 80, 85, 90, 100];
const NEXT_DEVICE_SIZES = [640, 750, 828, 1080, 1200, 1440, 1920, 2048, 3840];

function pickCandidateWidth(physicalPx: number, widths = NEXT_DEVICE_SIZES) {
  return widths.find((w) => w >= physicalPx) ?? widths[widths.length - 1];
}

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

  it('keeps listing hero mobile sizes at 1080w on 390px DPR 3 without capping desktop sharpness', () => {
    expect(BLOG_LISTING_FEATURED_IMAGE_SIZES).toBe(
      '(max-width: 767px) calc(100vw - 2rem), (max-width: 1440px) calc(100vw - 3rem), 1400px'
    );
    expect(BLOG_LISTING_FEATURED_IMAGE_PRELOAD_WIDTH).toBe(750);

    // 390px viewport with 2rem (32px) horizontal padding = 358px slot * 3 DPR = 1074px -> 1080w
    expect(pickCandidateWidth((390 - 32) * 3)).toBe(1080);
    // Desktop (>1440px) preserves 1400px container width (1440w at 1x, 3840w at 2x)
    expect(pickCandidateWidth(1400)).toBe(1440);
  });

  it('caps listing card sizes and srcSet width bounds to 384-750w', () => {
    expect(BLOG_LISTING_CARD_IMAGE_SIZES).toBe(
      '(max-width: 767px) calc(100vw - 2rem), (max-width: 1023px) calc(50vw - 2.5rem), (max-width: 1399px) 33vw, 430px'
    );
    expect(BLOG_LISTING_CARD_MIN_SRCSET_WIDTH).toBe(384);
    expect(BLOG_LISTING_CARD_MAX_SRCSET_WIDTH).toBe(750);

    const cardWidths = [384, 640, 750];
    expect(pickCandidateWidth((390 - 32) * 3, cardWidths)).toBe(750);
    expect(pickCandidateWidth(430, cardWidths)).toBe(640);
  });
});
