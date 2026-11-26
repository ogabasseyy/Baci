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

  it('caps srcSet rungs and fallback src to [minSrcSetWidth, maxSrcSetWidth] without leaking bound props', () => {
    const cover = `${CDN}/core-assets/blog/post/cover.jpg`;
    const result = getOgabasseyImageFormatProps({
      src: cover,
      fill: true,
      alt: 'Blog card',
      quality: 50,
      sizes: '(max-width: 767px) calc(100vw - 2rem), 430px',
      minSrcSetWidth: 384,
      maxSrcSetWidth: 750,
    });

    expect(result.avifSource?.srcSet).toBe(
      `${CDN}/image/width=384,quality=50,format=avif/core-assets/blog/post/cover.jpg 384w, ${CDN}/image/width=640,quality=50,format=avif/core-assets/blog/post/cover.jpg 640w, ${CDN}/image/width=750,quality=50,format=avif/core-assets/blog/post/cover.jpg 750w`
    );
    expect(result.imgProps.srcSet).toBe(
      `${CDN}/image/width=384,quality=50,format=jpeg/core-assets/blog/post/cover.jpg 384w, ${CDN}/image/width=640,quality=50,format=jpeg/core-assets/blog/post/cover.jpg 640w, ${CDN}/image/width=750,quality=50,format=jpeg/core-assets/blog/post/cover.jpg 750w`
    );
    expect(result.imgProps.src).toBe(
      `${CDN}/image/width=750,quality=50,format=jpeg/core-assets/blog/post/cover.jpg`
    );
    expect('minSrcSetWidth' in result.imgProps).toBe(false);
    expect('maxSrcSetWidth' in result.imgProps).toBe(false);
  });

  it('caps non-CDN srcSet rungs to maxSrcSetWidth and leaves avifSource null', () => {
    const src =
      'https://xyz.supabase.co/storage/v1/object/public/blog/cover.jpg';
    const result = getOgabasseyImageFormatProps({
      src,
      fill: true,
      alt: 'External card',
      quality: 50,
      sizes: '(max-width: 767px) calc(100vw - 2rem), 430px',
      minSrcSetWidth: 384,
      maxSrcSetWidth: 750,
    });

    expect(result.avifSource).toBeNull();
    expect(result.imgProps.srcSet).toBe(
      `${src}?w=384&q=50 384w, ${src}?w=640&q=50 640w, ${src}?w=750&q=50 750w`
    );
    expect(result.imgProps.src).toBe(`${src}?w=750&q=50`);
  });

  it('preserves overrideSrc and bounds fixed-size 1x/2x CDN and query w= candidates without altering path width=', () => {
    const cover = `${CDN}/core-assets/blog/post/cover.jpg`;
    const withOverride = getOgabasseyImageFormatProps({
      src: cover,
      overrideSrc: '/legacy-cover.jpg',
      fill: true,
      alt: 'Blog card',
      quality: 50,
      sizes: '(max-width: 767px) calc(100vw - 2rem), 430px',
      minSrcSetWidth: 384,
      maxSrcSetWidth: 750,
    });
    expect(withOverride.imgProps.src).toBe('/legacy-cover.jpg');
    expect(withOverride.imgProps.srcSet).not.toContain('828w');

    const fixed = getOgabasseyImageFormatProps({
      src: cover,
      width: 600,
      height: 400,
      alt: 'Fixed card',
      quality: 50,
      maxSrcSetWidth: 750,
    });
    expect(fixed.avifSource?.srcSet).toBe(
      `${CDN}/image/width=640,quality=50,format=avif/core-assets/blog/post/cover.jpg 1x`
    );
    expect(fixed.imgProps.src).toBe(
      `${CDN}/image/width=640,quality=50,format=jpeg/core-assets/blog/post/cover.jpg`
    );

    const pathToken = getOgabasseyImageFormatProps({
      src: '/images/width=1200/cover.jpg',
      width: 400,
      height: 300,
      alt: 'Local asset with width= in path',
      maxSrcSetWidth: 500,
    });
    expect(pathToken.imgProps.srcSet).toBe(
      '/images/width=1200/cover.jpg?w=500&q=75 1x'
    );
    expect(pathToken.imgProps.src).toBe(
      '/images/width=1200/cover.jpg?w=500&q=75'
    );
  });
});
