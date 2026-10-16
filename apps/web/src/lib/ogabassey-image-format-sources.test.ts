import { describe, expect, it, vi } from 'vitest';

// The global test setup (vitest.setup.ts) mocks 'next/image' with only a
// `default` export (a plain <img>-rendering stub) for component tests.
// getOgabasseyImageFormatProps calls the real `getImageProps` named export
// directly, so this file restores the real module.
vi.mock('next/image', async (importOriginal) => {
  const actual = await importOriginal<ImageModule>();
  return { ...actual };
});

import {
  buildOgabasseyAvifSrcSet,
  getOgabasseyImageFormatProps,
} from './ogabassey-image-format-sources';

type ImageModule = typeof import('next/image');

const CDN = 'https://cdn.ogabassey.com';

describe('buildOgabasseyAvifSrcSet', () => {
  it('returns null for a null, undefined, or empty srcSet', () => {
    expect(buildOgabasseyAvifSrcSet(null)).toBeNull();
    expect(buildOgabasseyAvifSrcSet(undefined)).toBeNull();
    expect(buildOgabasseyAvifSrcSet('')).toBeNull();
  });

  it('rewrites every candidate to format=avif, preserves width descriptors, and rejoins with ", "', () => {
    // Format-only transform URLs (no width/quality tokens) — the same shape
    // blog-inline-image-optimization.ts emits for its own AVIF sibling.
    const srcSet = [
      `${CDN}/image/format=jpeg/core-assets/products/phone-1.jpg 640w`,
      `${CDN}/image/format=jpeg/core-assets/products/phone-1.jpg 828w`,
      `${CDN}/image/format=jpeg/core-assets/products/phone-1.jpg 1200w`,
    ].join(', ');

    const avifSrcSet = buildOgabasseyAvifSrcSet(srcSet);

    expect(avifSrcSet).toBe(
      [
        `${CDN}/image/format=avif/core-assets/products/phone-1.jpg 640w`,
        `${CDN}/image/format=avif/core-assets/products/phone-1.jpg 828w`,
        `${CDN}/image/format=avif/core-assets/products/phone-1.jpg 1200w`,
      ].join(', ')
    );
  });

  it('rewrites a single candidate without a width descriptor', () => {
    const srcSet = `${CDN}/image/format=png/core-assets/products/phone.png`;

    expect(buildOgabasseyAvifSrcSet(srcSet)).toBe(
      `${CDN}/image/format=avif/core-assets/products/phone.png`
    );
  });

  it('returns null when any candidate lacks an AVIF twin (a non-transform URL)', () => {
    const srcSet = [
      `${CDN}/image/format=jpeg/core-assets/products/phone.jpg 640w`,
      // A plain, non-transform CDN asset URL has no format token to rewrite.
      `${CDN}/core-assets/products/phone.jpg 828w`,
    ].join(', ');

    expect(buildOgabasseyAvifSrcSet(srcSet)).toBeNull();
  });

  it('rewrites the real width+quality+format transform URLs the app loader emits, without being fooled by their internal commas', () => {
    // buildOgabasseyCdnImageLoaderUrl() always joins width, quality, and
    // format with commas inside the SAME candidate URL
    // (`width=750,quality=75,format=jpeg`). Those in-URL commas are never
    // followed by whitespace, while the srcset candidate separator always is
    // (", "), so splitting on `,\s+` (not a bare `,`) tells them apart and
    // every candidate reaches rewriteOgabasseyTransformUrlFormat intact.
    const realLoaderSrcSet = `${CDN}/image/width=640,quality=75,format=jpeg/core-assets/products/phone.jpg 640w, ${CDN}/image/width=750,quality=75,format=jpeg/core-assets/products/phone.jpg 750w`;

    expect(buildOgabasseyAvifSrcSet(realLoaderSrcSet)).toBe(
      `${CDN}/image/width=640,quality=75,format=avif/core-assets/products/phone.jpg 640w, ${CDN}/image/width=750,quality=75,format=avif/core-assets/products/phone.jpg 750w`
    );
  });
});

describe('getOgabasseyImageFormatProps', () => {
  it('returns a valid imgProps and a null avifSource for a non-CDN (Supabase) src', () => {
    const result = getOgabasseyImageFormatProps({
      src: 'https://xyz.supabase.co/storage/v1/object/public/products/phone.jpg',
      width: 800,
      height: 600,
      alt: 'Phone',
      sizes: '100vw',
    });

    expect(result.avifSource).toBeNull();
    expect(result.imgProps.alt).toBe('Phone');
    expect(result.imgProps.srcSet).toContain(
      'https://xyz.supabase.co/storage/v1/object/public/products/phone.jpg'
    );
    expect(result.imgProps.srcSet).not.toContain('format=avif');
  });

  it('returns a valid imgProps and a null avifSource for a placeholder src', () => {
    const result = getOgabasseyImageFormatProps({
      src: '/placeholder.svg',
      width: 800,
      height: 600,
      alt: 'Placeholder',
      sizes: '100vw',
    });

    expect(result.avifSource).toBeNull();
    expect(result.imgProps.alt).toBe('Placeholder');
  });

  it('returns avifSource as the format=avif twin of imgProps.srcSet for a real OgaBassey CDN product src through the real image loader', () => {
    const result = getOgabasseyImageFormatProps({
      src: `${CDN}/core-assets/products/phone.png`,
      width: 800,
      height: 600,
      alt: 'Phone',
      sizes: '100vw',
    });

    expect(result.imgProps.srcSet).toContain(`${CDN}/image/width=`);
    expect(result.imgProps.srcSet).toContain('format=png');
    expect(result.avifSource).not.toBeNull();
    expect(result.avifSource?.sizes).toBe(result.imgProps.sizes);
    // Same candidate ladder (same widths, same order), format token swapped.
    expect(result.avifSource?.srcSet).toBe(
      result.imgProps.srcSet?.replace(/format=png/g, 'format=avif')
    );
  });

  it('derives avifSource as the format=avif twin of imgProps.srcSet when the loader emits format-only candidates', async () => {
    // Isolates getOgabasseyImageFormatProps' own composition logic (pairing
    // avifSource with imgProps from ONE getImageProps pass) from the
    // width+quality-comma gap above, by mocking next/image's getImageProps to
    // emit the same format-only candidate shape used in the
    // buildOgabasseyAvifSrcSet tests. This proves the pairing logic itself
    // (sizes carried over, srcSet rewritten 1:1) is correct — only the real
    // loader's comma-joined options segment defeats it today.
    vi.resetModules();
    vi.doMock('next/image', () => ({
      getImageProps: vi.fn(
        ({ alt, sizes }: { alt?: string; sizes?: string }) => ({
          props: {
            alt,
            sizes,
            src: `${CDN}/image/format=jpeg/core-assets/products/phone.jpg`,
            srcSet: `${CDN}/image/format=jpeg/core-assets/products/phone-640.jpg 640w, ${CDN}/image/format=jpeg/core-assets/products/phone-828.jpg 828w`,
          },
        })
      ),
    }));

    try {
      const { getOgabasseyImageFormatProps: getPropsWithMockedNextImage } =
        await import('./ogabassey-image-format-sources');

      const result = getPropsWithMockedNextImage({
        src: 'phone',
        width: 800,
        height: 600,
        alt: 'Phone',
        sizes: '100vw',
      });

      expect(result.avifSource).not.toBeNull();
      expect(result.avifSource?.sizes).toBe(result.imgProps.sizes);
      expect(result.avifSource?.srcSet).toBe(
        `${CDN}/image/format=avif/core-assets/products/phone-640.jpg 640w, ${CDN}/image/format=avif/core-assets/products/phone-828.jpg 828w`
      );
    } finally {
      vi.doUnmock('next/image');
      vi.resetModules();
    }
  });
});
