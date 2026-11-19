import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/image')>();
  return { ...actual };
});

import {
  capSrcSetWidthRungs,
  getOgabasseyHeroLcpImage,
} from './hero-lcp-image-descriptor';
import {
  MOBILE_HERO_IMAGE_QUALITY,
  MOBILE_HERO_IMAGE_SIZES,
  MOBILE_HERO_LCP_MAX_BYTES,
  MOBILE_HERO_MAX_SRCSET_WIDTH,
  MOBILE_HERO_QUALITY_STEPS,
  MOBILE_HERO_SOURCE_MEDIA,
} from './hero-mobile-image-config';
import { selectHeroAvifQualityForByteCap } from './select-hero-avif-quality-for-byte-cap';

const CDN_HERO =
  'https://cdn.ogabassey.com/core-assets/products/tecno-spark-40-pro.avif';

describe('hero-lcp-image-descriptor', () => {
  it('builds a shared same-origin /cdn-image/ descriptor from either a slide object or raw URL string', () => {
    const fromUrl = getOgabasseyHeroLcpImage(CDN_HERO);
    const fromSlide = getOgabasseyHeroLcpImage({ imageUrl: CDN_HERO });

    expect(fromUrl).not.toBeNull();
    expect(fromSlide).toEqual(fromUrl);
    expect(fromUrl).toMatchObject({
      media: MOBILE_HERO_SOURCE_MEDIA,
      quality: MOBILE_HERO_IMAGE_QUALITY,
      sizes: MOBILE_HERO_IMAGE_SIZES,
    });
    expect(fromUrl?.avifSrc).toMatch(/^\/cdn-image\/.*format=avif/);
    expect(fromUrl?.avifSrcSet).toMatch(/^\/cdn-image\/.*format=avif/);
    expect(fromUrl?.src).toMatch(/^\/cdn-image\/.*format=jpeg/);
    expect(fromUrl?.srcSet).toMatch(/^\/cdn-image\/.*format=jpeg/);
  });

  it('steps mobile hero AVIF quality down 70 -> 60 -> 50 to honor the 20 KB byte cap', () => {
    expect(MOBILE_HERO_LCP_MAX_BYTES).toBe(20_000);
    expect(MOBILE_HERO_QUALITY_STEPS).toEqual([70, 60, 50]);
    expect(
      selectHeroAvifQualityForByteCap([
        { quality: 70, bytes: 16_593 },
        { quality: 60, bytes: 13_200 },
        { quality: 50, bytes: 10_400 },
      ])
    ).toEqual({ quality: 70, bytes: 16_593 });
    expect(
      selectHeroAvifQualityForByteCap([
        { quality: 70, bytes: 24_100 },
        { quality: 60, bytes: 18_450 },
        { quality: 50, bytes: 14_100 },
      ])
    ).toEqual({ quality: 60, bytes: 18_450 });
    expect(
      selectHeroAvifQualityForByteCap([
        { quality: 70, bytes: 28_000 },
        { quality: 60, bytes: 22_500 },
        { quality: 50, bytes: 17_900 },
      ])
    ).toEqual({ quality: 50, bytes: 17_900 });
  });

  it('caps mobile hero srcSet rungs at <= 750w and at most 2 entries', () => {
    const descriptor = getOgabasseyHeroLcpImage(CDN_HERO);
    expect(descriptor).not.toBeNull();

    const widths = (descriptor?.avifSrcSet ?? '')
      .split(/,\s+/)
      .map((entry) => Number.parseInt(entry.match(/\s+(\d+)w$/)?.[1] ?? '0', 10));

    expect(widths.length).toBeGreaterThan(0);
    expect(widths.length).toBeLessThanOrEqual(2);
    for (const width of widths) {
      expect(width).toBeLessThanOrEqual(MOBILE_HERO_MAX_SRCSET_WIDTH);
    }
  });

  it('returns null for blank or missing slide sources', () => {
    expect(getOgabasseyHeroLcpImage(null)).toBeNull();
    expect(getOgabasseyHeroLcpImage(undefined)).toBeNull();
    expect(getOgabasseyHeroLcpImage('   ')).toBeNull();
    expect(getOgabasseyHeroLcpImage({ imageUrl: '  ' })).toBeNull();
  });

  it('caps arbitrary srcSet ladders to the requested min/max width bounds', () => {
    const ladder = [256, 384, 640, 750, 828, 1080, 1920, 3840]
      .map((w) => `https://cdn.ogabassey.com/image/width=${w}/item.jpg ${w}w`)
      .join(', ');

    expect(capSrcSetWidthRungs(ladder, 750, 384)).toBe(
      'https://cdn.ogabassey.com/image/width=384/item.jpg 384w, https://cdn.ogabassey.com/image/width=750/item.jpg 750w'
    );
    expect(capSrcSetWidthRungs(ladder, 1080, 640)).toBe(
      'https://cdn.ogabassey.com/image/width=640/item.jpg 640w, https://cdn.ogabassey.com/image/width=1080/item.jpg 1080w'
    );
    expect(capSrcSetWidthRungs(ladder, 384)).toBe(
      'https://cdn.ogabassey.com/image/width=256/item.jpg 256w, https://cdn.ogabassey.com/image/width=384/item.jpg 384w'
    );
  });

  it('falls back to a single rung if a 2-rung srcSet would exceed the inline byte budget', () => {
    const longPath = 'a'.repeat(180);
    const ladder = [384, 750]
      .map(
        (w) =>
          `https://cdn.ogabassey.com/image/width=${w},quality=70,format=avif/core-assets/products/${longPath}.png ${w}w`
      )
      .join(', ');

    const capped = capSrcSetWidthRungs(ladder, 750, 384);
    expect(capped).toContain('750w');
    expect(capped).not.toContain('384w');
  });

  it('keeps the AVIF tier for a hero source that is already a same-origin /cdn-image/ URL', () => {
    const descriptor = getOgabasseyHeroLcpImage(
      '/cdn-image/width=384,quality=70,format=avif/core-assets/products/tecno-spark-40-pro.avif'
    );

    expect(descriptor?.avifSrc).toMatch(/^\/cdn-image\/.*format=avif/);
    expect(descriptor?.avifSrcSet).toMatch(/^\/cdn-image\/.*format=avif/);
    expect(descriptor?.src).toMatch(/^\/cdn-image\/.*format=jpeg/);
    expect(descriptor?.srcSet).not.toMatch(/[?&](w|q)=/);
  });
});

