import { describe, expect, it } from 'vitest';
import {
  MOBILE_HERO_IMAGE_QUALITY,
  MOBILE_HERO_IMAGE_SIZES,
  MOBILE_HERO_SOURCE_MEDIA,
} from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import { ogabasseyHomeHeroResourceHintProjection } from './ogabassey-home-hero-resource-hint-projection';

const CDN_HERO =
  'https://cdn.ogabassey.com/core-assets/products/tecno-spark-40-pro.avif';

describe('ogabasseyHomeHeroResourceHintProjection', () => {
  it('builds the complete live AVIF preload identity from one CDN source', () => {
    const projection = ogabasseyHomeHeroResourceHintProjection.build(CDN_HERO);

    expect(projection).toMatchObject({
      as: 'image',
      fetchPriority: 'high',
      imageSizes: MOBILE_HERO_IMAGE_SIZES,
      imageUrl: CDN_HERO,
      media: MOBILE_HERO_SOURCE_MEDIA,
      quality: MOBILE_HERO_IMAGE_QUALITY,
      type: 'image/avif',
      version: 1,
    });
    expect(projection?.href).toContain('format=avif');
    expect(projection?.imageSrcSet).toContain('format=avif');
    expect(projection?.imageSrcSet).not.toContain('format=auto');
    expect(projection?.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(
      projection && ogabasseyHomeHeroResourceHintProjection.validate(projection)
    ).toBe(true);
  });

  it('returns null for blank and non-CDN images exactly like the live emitter', () => {
    expect(ogabasseyHomeHeroResourceHintProjection.build(null)).toBeNull();
    expect(ogabasseyHomeHeroResourceHintProjection.build('  ')).toBeNull();
    expect(
      ogabasseyHomeHeroResourceHintProjection.build(
        'https://example.com/hero.jpg'
      )
    ).toBeNull();
  });

  it.each([
    null,
    undefined,
    42,
    '',
    { imageUrl: 42 },
  ])('rejects malformed validation input: %j', (input) => {
    expect(ogabasseyHomeHeroResourceHintProjection.validate(input)).toBe(false);
  });

  it.each([
    ['as', 'font'],
    ['href', 'https://cdn.ogabassey.com/wrong.avif'],
    ['imageSrcSet', 'wrong 960w'],
    ['imageSizes', '100vw'],
    ['media', '(min-width: 768px)'],
    ['type', 'image/webp'],
    ['fetchPriority', 'low'],
    ['quality', 1],
    ['imageUrl', 'https://cdn.ogabassey.com/wrong-source.avif'],
    ['digest', '0'.repeat(64)],
    ['version', 2],
  ] as const)('rejects %s drift across the whole identity', (field, value) => {
    const projection = ogabasseyHomeHeroResourceHintProjection.build(CDN_HERO);
    if (!projection) {
      throw new Error('expected CDN preload projection');
    }

    expect(
      ogabasseyHomeHeroResourceHintProjection.validate({
        ...projection,
        [field]: value,
      })
    ).toBe(false);
  });

  it('rejects a whitespace-padded source instead of silently canonicalizing supplied identity', () => {
    const projection = ogabasseyHomeHeroResourceHintProjection.build(CDN_HERO);
    if (!projection) {
      throw new Error('expected CDN preload projection');
    }

    expect(
      ogabasseyHomeHeroResourceHintProjection.validate({
        ...projection,
        imageUrl: ` ${projection.imageUrl} `,
      })
    ).toBe(false);
  });
});
