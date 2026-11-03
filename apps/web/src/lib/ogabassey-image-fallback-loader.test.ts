import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_QUALITY } from '@/config/cdn';
import { ogabasseyFallbackImageLoader } from './ogabassey-image-fallback-loader';

const CDN = 'https://cdn.ogabassey.com';

describe('ogabasseyFallbackImageLoader', () => {
  it('emits an explicit jpeg fallback transform URL for a CDN jpeg/avif product image', () => {
    const url = ogabasseyFallbackImageLoader({
      quality: 35,
      src: `${CDN}/core-assets/products/phone.avif`,
      width: 750,
    });

    expect(url).toBe(
      `${CDN}/image/width=750,quality=35,format=jpeg/core-assets/products/phone.avif`
    );
  });

  it('keeps PNG sources on the png fallback tier to preserve transparency', () => {
    const url = ogabasseyFallbackImageLoader({
      quality: 75,
      src: `${CDN}/core-assets/products/phone.png`,
      width: 640,
    });

    expect(url).toBe(
      `${CDN}/image/width=640,quality=75,format=png/core-assets/products/phone.png`
    );
  });

  it('defaults an absent quality to DEFAULT_IMAGE_QUALITY, matching the global loader', () => {
    const url = ogabasseyFallbackImageLoader({
      src: `${CDN}/core-assets/products/phone.jpg`,
      width: 640,
    });

    expect(url).toBe(
      `${CDN}/image/width=640,quality=${DEFAULT_IMAGE_QUALITY},format=jpeg/core-assets/products/phone.jpg`
    );
  });

  it('delegates non-CDN sources to the global imageLoader (no AVIF twin)', () => {
    const src =
      'https://xyz.supabase.co/storage/v1/object/public/products/phone.jpg';
    const url = ogabasseyFallbackImageLoader({
      quality: 60,
      src,
      width: 828,
    });

    expect(url).toContain(src);
    expect(url).toContain('w=828');
    expect(url).toContain('q=60');
    expect(url).not.toContain('/image/');
    expect(url).not.toContain('format=');
  });

  it('never emits format=auto for a CDN source', () => {
    const url = ogabasseyFallbackImageLoader({
      quality: 35,
      src: `${CDN}/core-assets/products/laptop.webp`,
      width: 1080,
    });

    expect(url).not.toContain('format=auto');
    expect(url).toContain('format=jpeg');
  });

  it('re-sizes a same-origin /cdn-image/ proxy URL in its path without appending w/q params', () => {
    const url = ogabasseyFallbackImageLoader({
      quality: 60,
      src: '/cdn-image/width=384,quality=70,format=avif/core-assets/products/phone.jpg',
      width: 640,
    });

    expect(url).toBe(
      '/cdn-image/width=640,quality=60,format=jpeg/core-assets/products/phone.jpg'
    );
  });

  it('preserves the allowed ?v= version param on a /cdn-image/ proxy URL', () => {
    const url = ogabasseyFallbackImageLoader({
      quality: 75,
      src: '/cdn-image/width=384,quality=70,format=avif/core-assets/products/phone.png?v=abc123',
      width: 828,
    });

    expect(url).toBe(
      '/cdn-image/width=828,quality=75,format=png/core-assets/products/phone.png?v=abc123'
    );
  });
});
