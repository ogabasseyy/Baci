import { describe, expect, it } from 'vitest';
import { resolveAdvertisedVariantImage } from './resolve-advertised-variant-image';

describe('resolveAdvertisedVariantImage', () => {
  it('prefers the non-empty primary_image', () => {
    expect(
      resolveAdvertisedVariantImage({
        primary_image: 'https://cdn.example.com/primary.jpg',
        images: ['https://cdn.example.com/gallery.jpg'],
      })
    ).toBe('https://cdn.example.com/primary.jpg');
  });

  it('falls back to the first non-empty gallery image when primary_image is missing or whitespace', () => {
    expect(
      resolveAdvertisedVariantImage({
        primary_image: '   ',
        images: ['', 'https://cdn.example.com/gallery.jpg'],
      })
    ).toBe('https://cdn.example.com/gallery.jpg');

    expect(
      resolveAdvertisedVariantImage({
        primary_image: null,
        images: ['https://cdn.example.com/first.jpg'],
      })
    ).toBe('https://cdn.example.com/first.jpg');
  });

  it('returns undefined when no valid image string is present', () => {
    expect(resolveAdvertisedVariantImage(null)).toBeUndefined();
    expect(resolveAdvertisedVariantImage(undefined)).toBeUndefined();
    expect(
      resolveAdvertisedVariantImage({
        primary_image: '  ',
        images: ['  ', ''],
      })
    ).toBeUndefined();
    expect(
      resolveAdvertisedVariantImage({
        primary_image: null,
        images: null,
      })
    ).toBeUndefined();
  });
});
