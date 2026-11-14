import { describe, expect, it } from 'vitest';
import { resolveVariantSeoImages } from './resolve-variant-seo-images';

describe('resolveVariantSeoImages', () => {
  const fallback = ['https://example.com/parent-1.jpg'];

  it('falls back to parent images when variant has no images or primary_image', () => {
    expect(resolveVariantSeoImages({}, fallback)).toEqual(fallback);
    expect(
      resolveVariantSeoImages({ primary_image: null, images: [] }, fallback)
    ).toEqual(fallback);
    expect(
      resolveVariantSeoImages(
        { primary_image: '   ', images: ['   ', ''] },
        fallback
      )
    ).toEqual(fallback);
  });

  it('returns undefined when neither variant nor parent has images', () => {
    expect(resolveVariantSeoImages({})).toBeUndefined();
    expect(resolveVariantSeoImages({}, [])).toBeUndefined();
  });

  it('uses variant images gallery when present and trims URLs', () => {
    const result = resolveVariantSeoImages(
      {
        images: [
          ' https://example.com/v-1.jpg ',
          'https://example.com/v-2.jpg',
        ],
      },
      fallback
    );
    expect(result).toEqual([
      'https://example.com/v-1.jpg',
      'https://example.com/v-2.jpg',
    ]);
  });

  it('prioritizes primary_image and trims surrounding whitespace before deduplication', () => {
    const result = resolveVariantSeoImages(
      {
        primary_image: ' https://example.com/p-1.jpg ',
        images: [
          'https://example.com/p-1.jpg',
          ' https://example.com/p-2.jpg ',
        ],
      },
      fallback
    );

    expect(result).toEqual([
      'https://example.com/p-1.jpg',
      'https://example.com/p-2.jpg',
    ]);
  });

  it('prepends primary_image when not already present in images gallery', () => {
    const result = resolveVariantSeoImages(
      {
        primary_image: 'https://example.com/featured.jpg',
        images: ['https://example.com/side.jpg'],
      },
      fallback
    );

    expect(result).toEqual([
      'https://example.com/featured.jpg',
      'https://example.com/side.jpg',
    ]);
  });
});
