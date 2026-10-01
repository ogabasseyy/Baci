// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, preload: vi.fn() };
});

// See cdn-format-image.test.tsx: restore the real 'next/image' module so
// getOgabasseyImageFormatProps can call the named `getImageProps` export.
vi.mock('next/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/image')>();
  return { ...actual };
});

import type { CdnFormatImageProps } from './cdn-format-image';

const CDN = 'https://cdn.ogabassey.com';

async function renderWithFormatProps(
  overrides: {
    avifSource: { sizes?: string; srcSet: string } | null;
    imgProps: Record<string, unknown>;
  },
  props?: Partial<CdnFormatImageProps>
) {
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
      {...props}
    />
  );
}

function cdnOverrides() {
  return {
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
  };
}

describe('CdnFormatImage disableAvifTier', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/ogabassey-image-format-sources');
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('renders a bare <img> with no AVIF source when the tier is disabled', async () => {
    // Surfaces swapped in over an already-fetched JPEG (homepage grid
    // after its AVIF-free static fallback) must reuse the cached bytes
    // instead of downloading the AVIF tier.
    const markup = await renderWithFormatProps(cdnOverrides(), {
      disableAvifTier: true,
    });

    expect(markup).not.toContain('<picture');
    expect(markup).not.toContain('<source');
    expect(markup).toContain('<img');
    expect(markup).not.toContain('format=avif');
  });

  it('skips the AVIF preload when the tier is disabled', async () => {
    await renderWithFormatProps(cdnOverrides(), {
      disableAvifTier: true,
      preload: true,
    });

    // Post-reset registry instance: resetModules gives the re-imported
    // component a fresh mocked react-dom, so the top-level static import
    // would assert against a stale mock.
    const { preload: freshPreload } = await import('react-dom');
    expect(freshPreload).not.toHaveBeenCalledWith(
      expect.stringContaining('format=avif'),
      expect.anything()
    );
  });

  it('keeps the AVIF tier by default', async () => {
    const markup = await renderWithFormatProps(cdnOverrides());

    expect(markup).toContain('<picture');
    expect(markup).toContain('type="image/avif"');
  });
});
