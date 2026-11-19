// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, preload: vi.fn() };
});

// The global test setup (vitest.setup.ts) mocks 'next/image' with only a
// `default` export. CdnFormatImage's real dependency chain
// (getOgabasseyImageFormatProps) calls the named `getImageProps` export, so
// this file restores the real 'next/image' module.
vi.mock('next/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/image')>();
  return { ...actual };
});

import { preload } from 'react-dom';

const CDN = 'https://cdn.ogabassey.com';

describe('CdnFormatImage (preload side effect, mocked format-source)', () => {
  beforeEach(() => {
    vi.mocked(preload).mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/ogabassey-image-format-sources');
    vi.resetModules();
  });

  it('preloads the AVIF tier with type="image/avif" when an avifSource is present', async () => {
    vi.doMock('@/lib/ogabassey-image-format-sources', () => ({
      getOgabasseyImageFormatProps: vi.fn(() => ({
        avifSource: {
          sizes: '100vw',
          srcSet: `${CDN}/image/format=avif/core-assets/products/phone-640.jpg 640w`,
        },
        imgProps: {
          alt: 'Phone',
          fetchPriority: 'high',
          sizes: '100vw',
          src: `${CDN}/image/format=jpeg/core-assets/products/phone-640.jpg`,
          srcSet: `${CDN}/image/format=jpeg/core-assets/products/phone-640.jpg 640w`,
        },
      })),
    }));
    const { CdnFormatImage: Component } = await import('./cdn-format-image');

    renderToStaticMarkup(
      <Component
        src="unused-because-mocked"
        alt="Phone"
        width={800}
        height={600}
        preload
      />
    );

    expect(preload).toHaveBeenCalledTimes(1);
    const [href, options] = vi.mocked(preload).mock.calls[0];
    expect(href).toBe(
      `${CDN}/image/format=avif/core-assets/products/phone-640.jpg`
    );
    expect(options).toMatchObject({ type: 'image/avif' });
  });

  it('preloads the plain srcset with no type when there is no avifSource', async () => {
    vi.doMock('@/lib/ogabassey-image-format-sources', () => ({
      getOgabasseyImageFormatProps: vi.fn(() => ({
        avifSource: null,
        imgProps: {
          alt: 'Phone',
          fetchPriority: 'high',
          sizes: '100vw',
          src: 'https://xyz.supabase.co/storage/v1/object/public/products/phone.jpg',
          srcSet:
            'https://xyz.supabase.co/storage/v1/object/public/products/phone.jpg 640w',
        },
      })),
    }));
    const { CdnFormatImage: Component } = await import('./cdn-format-image');

    renderToStaticMarkup(
      <Component
        src="unused-because-mocked"
        alt="Phone"
        width={800}
        height={600}
        preload
      />
    );

    expect(preload).toHaveBeenCalledTimes(1);
    const [href, options] = vi.mocked(preload).mock.calls[0];
    expect(href).toBe(
      'https://xyz.supabase.co/storage/v1/object/public/products/phone.jpg'
    );
    expect(options).not.toHaveProperty('type');
  });

  it('defaults fetchPriority="high" on both preload() and the rendered <img> when preload is true', async () => {
    vi.doMock('@/lib/ogabassey-image-format-sources', () => ({
      getOgabasseyImageFormatProps: vi.fn(() => ({
        avifSource: {
          sizes: '100vw',
          srcSet: `${CDN}/image/format=avif/core-assets/products/phone-640.jpg 640w`,
        },
        imgProps: {
          alt: 'Hero Phone',
          sizes: '100vw',
          src: `${CDN}/image/format=jpeg/core-assets/products/phone-640.jpg`,
          srcSet: `${CDN}/image/format=jpeg/core-assets/products/phone-640.jpg 640w`,
        },
      })),
    }));
    const { CdnFormatImage: Component } = await import('./cdn-format-image');

    const markup = renderToStaticMarkup(
      <Component
        src="unused-because-mocked"
        alt="Hero Phone"
        width={800}
        height={600}
        preload
      />
    );

    expect(preload).toHaveBeenCalledWith(
      `${CDN}/image/format=avif/core-assets/products/phone-640.jpg`,
      expect.objectContaining({
        fetchPriority: 'high',
        type: 'image/avif',
      })
    );
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    expect(doc.querySelector('img')?.getAttribute('fetchpriority')).toBe(
      'high'
    );
  });
});
