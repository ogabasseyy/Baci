// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The global test setup (vitest.setup.ts) mocks 'next/image' with only a
// `default` export. CdnFormatImage's real dependency chain
// (getOgabasseyImageFormatProps) calls the named `getImageProps` export, so
// this file restores the real 'next/image' module.
vi.mock('next/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/image')>();
  return { ...actual };
});

import { CdnFormatImage } from './cdn-format-image';

const CDN = 'https://cdn.ogabassey.com';

interface MockedFormatProps {
  avifSource: { sizes?: string; srcSet: string } | null;
  imgProps: Record<string, unknown>;
}

/**
 * Renders CdnFormatImage with `getOgabasseyImageFormatProps` swapped for a
 * canned return value, so each test can drive the component's own
 * `avifSource ? <picture> : <img>` branch directly instead of depending on
 * whatever the real `next/image` + CDN loader pipeline happens to produce
 * (see the "real pipeline" describe block below for that end-to-end case).
 */
async function renderWithFormatProps(overrides: MockedFormatProps) {
  vi.doMock('@/lib/ogabassey-image-format-sources', () => ({
    getOgabasseyImageFormatProps: vi.fn(() => overrides),
  }));

  const { CdnFormatImage: Component } = await import('./cdn-format-image');

  return renderToStaticMarkup(
    <Component
      src="unused-because-mocked"
      alt="Phone"
      width={800}
      height={600}
    />
  );
}

describe('CdnFormatImage (branch logic, mocked format-source)', () => {
  beforeEach(() => {
    // Vitest caches the module graph from this file's top-level static
    // `import { CdnFormatImage } from './cdn-format-image'`, which already
    // resolved the REAL '@/lib/ogabassey-image-format-sources'. Without a
    // reset here, the very first dynamic re-import below returns that cached
    // (unmocked) module instead of picking up `vi.doMock`.
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/ogabassey-image-format-sources');
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('renders a <picture> with an image/avif <source> and an <img> fallback for a CDN src', async () => {
    const markup = await renderWithFormatProps({
      avifSource: {
        sizes: '100vw',
        srcSet: `${CDN}/image/format=avif/core-assets/products/phone-640.jpg 640w`,
      },
      imgProps: {
        alt: 'Phone',
        sizes: '100vw',
        src: `${CDN}/image/format=jpeg/core-assets/products/phone-640.jpg`,
        srcSet: `${CDN}/image/format=jpeg/core-assets/products/phone-640.jpg 640w`,
      },
    });

    expect(markup).toContain('<picture');
    expect(markup).toContain('style="display:contents"');
    expect(markup).toContain('<source');
    expect(markup).toContain('type="image/avif"');
    expect(markup).toContain('<img');

    const sourceSrcSet = markup.match(/<source[^>]*srcSet="([^"]*)"/)?.[1];
    expect(sourceSrcSet).toContain('format=avif');
    expect(sourceSrcSet).not.toContain('format=auto');
  });

  it('renders a bare <img> with no <picture>/<source> for a non-CDN src', async () => {
    const markup = await renderWithFormatProps({
      avifSource: null,
      imgProps: {
        alt: 'Phone',
        sizes: '100vw',
        src: 'https://xyz.supabase.co/storage/v1/object/public/products/phone.jpg',
        srcSet:
          'https://xyz.supabase.co/storage/v1/object/public/products/phone.jpg 640w',
      },
    });

    expect(markup).not.toContain('<picture');
    expect(markup).not.toContain('<source');
    expect(markup).toContain('<img');
  });

  it('retries the fallback tier before forwarding an image error', async () => {
    const onError = vi.fn();
    const removeSpy = vi.spyOn(Element.prototype, 'remove');
    vi.doMock('@/lib/ogabassey-image-format-sources', () => ({
      getOgabasseyImageFormatProps: vi.fn(() => ({
        avifSource: {
          sizes: '100vw',
          srcSet: `${CDN}/image/format=avif/core-assets/products/phone-640.jpg 640w`,
        },
        imgProps: {
          alt: 'Phone',
          sizes: '100vw',
          src: `${CDN}/image/format=jpeg/core-assets/products/phone-640.jpg`,
          srcSet: `${CDN}/image/format=jpeg/core-assets/products/phone-640.jpg 640w`,
        },
      })),
    }));
    const { CdnFormatImage: Component } = await import('./cdn-format-image');
    const { container } = render(
      <Component
        alt="Phone"
        height={600}
        onError={onError}
        src="unused-because-mocked"
        width={800}
      />
    );
    const image = container.querySelector('img');

    expect(image).not.toBeNull();

    // An AVIF-capable browser selected the AVIF <source>, so currentSrc names
    // the AVIF tier when it fails first.
    Object.defineProperty(image as HTMLImageElement, 'currentSrc', {
      configurable: true,
      value: `${CDN}/image/format=avif/core-assets/products/phone-640.jpg`,
    });
    fireEvent.error(image as HTMLImageElement);

    expect(removeSpy).not.toHaveBeenCalled();
    expect(container.querySelector('source[type="image/avif"]')).toBeNull();
    expect(onError).not.toHaveBeenCalled();

    // The browser now falls back to the jpeg <img>; its failure must reach the
    // caller.
    const fallbackImage = container.querySelector('img');
    expect(fallbackImage).not.toBeNull();
    Object.defineProperty(fallbackImage as HTMLImageElement, 'currentSrc', {
      configurable: true,
      value: `${CDN}/image/format=jpeg/core-assets/products/phone-640.jpg`,
    });
    fireEvent.error(fallbackImage as HTMLImageElement);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('forwards a fallback failure to the caller when the AVIF source was never selected (non-AVIF browser)', async () => {
    const onError = vi.fn();
    vi.doMock('@/lib/ogabassey-image-format-sources', () => ({
      getOgabasseyImageFormatProps: vi.fn(() => ({
        avifSource: {
          sizes: '100vw',
          srcSet: `${CDN}/image/format=avif/core-assets/products/phone-640.jpg 640w`,
        },
        imgProps: {
          alt: 'Phone',
          sizes: '100vw',
          src: `${CDN}/image/format=jpeg/core-assets/products/phone-640.jpg`,
          srcSet: `${CDN}/image/format=jpeg/core-assets/products/phone-640.jpg 640w`,
        },
      })),
    }));
    const { CdnFormatImage: Component } = await import('./cdn-format-image');
    const { container } = render(
      <Component
        alt="Phone"
        height={600}
        onError={onError}
        src="unused-because-mocked"
        width={800}
      />
    );
    const image = container.querySelector('img');

    expect(image).not.toBeNull();

    // A browser without AVIF support skips <source type="image/avif"> and loads
    // the jpeg fallback directly, so currentSrc is the jpeg tier even though the
    // unused AVIF <source> is still in the DOM. A genuine fallback 404 here must
    // not be swallowed by the AVIF strip-and-retry branch.
    Object.defineProperty(image as HTMLImageElement, 'currentSrc', {
      configurable: true,
      value: `${CDN}/image/format=jpeg/core-assets/products/phone-640.jpg`,
    });
    fireEvent.error(image as HTMLImageElement);

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('keeps the failed AVIF source removed across a parent rerender', async () => {
    vi.doMock('@/lib/ogabassey-image-format-sources', () => ({
      getOgabasseyImageFormatProps: vi.fn(() => ({
        avifSource: {
          sizes: '100vw',
          srcSet: `${CDN}/image/format=avif/core-assets/products/phone-640.jpg 640w`,
        },
        imgProps: {
          alt: 'Phone',
          sizes: '100vw',
          src: `${CDN}/image/format=jpeg/core-assets/products/phone-640.jpg`,
          srcSet: `${CDN}/image/format=jpeg/core-assets/products/phone-640.jpg 640w`,
        },
      })),
    }));
    const { CdnFormatImage: Component } = await import('./cdn-format-image');
    const props = {
      alt: 'Phone',
      height: 600,
      src: 'unused-because-mocked',
      width: 800,
    } as const;
    const { container, rerender } = render(<Component {...props} />);
    const image = container.querySelector('img');

    expect(image).not.toBeNull();
    Object.defineProperty(image as HTMLImageElement, 'currentSrc', {
      configurable: true,
      value: `${CDN}/image/format=avif/core-assets/products/phone-640.jpg`,
    });
    fireEvent.error(image as HTMLImageElement);
    expect(container.querySelector('source[type="image/avif"]')).toBeNull();

    rerender(<Component {...props} />);

    expect(container.querySelector('source[type="image/avif"]')).toBeNull();
  });

  it('carries the alt text through onto the rendered <img>', async () => {
    const markup = await renderWithFormatProps({
      avifSource: null,
      imgProps: {
        alt: 'A red phone on a white background',
        src: 'https://example.com/placeholder.jpg',
      },
    });

    expect(markup).toContain('alt="A red phone on a white background"');
  });
});

describe('CdnFormatImage (real pipeline — no ogabassey-image-format-sources mocking)', () => {
  it('renders a <picture> with an image/avif <source> for a real OgaBassey CDN product src', () => {
    // End-to-end through the REAL getOgabasseyImageFormatProps + the app's
    // real image-loader (no mocking of '@/lib/ogabassey-image-format-sources'
    // here) — proves the component actually ships the AVIF tier for a real
    // product photo, not just for hand-crafted format props.
    const markup = renderToStaticMarkup(
      <CdnFormatImage
        src={`${CDN}/core-assets/products/phone.png`}
        alt="Phone"
        width={800}
        height={600}
        sizes="100vw"
      />
    );

    expect(markup).toContain('<picture');
    expect(markup).toContain('style="display:contents"');
    expect(markup).toContain('type="image/avif"');
    expect(markup).toContain('<img');
    expect(markup).toContain('alt="Phone"');

    const sourceSrcSet = markup.match(/<source[^>]*srcSet="([^"]*)"/)?.[1];
    expect(sourceSrcSet).toContain('format=avif');
    expect(sourceSrcSet).not.toContain('format=auto');
  });

  it('renders a bare <img> with no <picture>/<source> for a non-CDN (Supabase) src', () => {
    const markup = renderToStaticMarkup(
      <CdnFormatImage
        src="https://xyz.supabase.co/storage/v1/object/public/products/phone.jpg"
        alt="Phone"
        width={800}
        height={600}
        sizes="100vw"
      />
    );

    expect(markup).not.toContain('<picture');
    expect(markup).not.toContain('<source');
    expect(markup).toContain('<img');
  });
});
