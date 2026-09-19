import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeProductGridFallbackImage } from './home-product-grid-fallback-image';

describe('HomeProductGridFallbackImage', () => {
  it('renders a lazy image with the card class and alt', () => {
    render(
      <HomeProductGridFallbackImage
        alt="iPhone 17 Pro Max"
        src="https://example.com/iphone.jpg"
      />
    );

    const img = screen.getByAltText('iPhone 17 Pro Max');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(img).toHaveClass('ogabassey-home-product-card__image');
  });

  it('renders inside a picture wrapper or as a plain image', () => {
    const { container } = render(
      <HomeProductGridFallbackImage alt="" src="https://example.com/x.jpg" />
    );

    // Non-CDN sources have no AVIF tier and render the plain <img> the
    // interactive card renders; CDN sources add the <picture> wrapper.
    expect(container.querySelector('picture, img')).not.toBeNull();
  });

  it('drops a failed AVIF tier so the JPEG fallback renders', async () => {
    // Mirrors CdnFormatImage: when an AVIF-capable browser selects the
    // AVIF source but the transform fails, <picture> would never retry
    // the JPEG <img> — the card would stay broken until the deferred grid
    // mounts. Dropping the failed source lets the in-tree fallback show.
    const avifSrcSet =
      'https://cdn.example.com/image/format=avif/phone-640.jpg 640w';
    vi.resetModules();
    vi.doMock('@/lib/ogabassey-image-format-sources', () => ({
      getOgabasseyImageFormatProps: vi.fn(() => ({
        avifSource: { sizes: '100vw', srcSet: avifSrcSet },
        imgProps: {
          alt: 'Phone',
          sizes: '100vw',
          src: 'https://cdn.example.com/image/format=jpeg/phone-640.jpg',
          srcSet:
            'https://cdn.example.com/image/format=jpeg/phone-640.jpg 640w',
        },
      })),
    }));
    const { HomeProductGridFallbackImage: Component } = await import(
      './home-product-grid-fallback-image'
    );
    const { container } = render(
      <Component alt="Phone" src="unused-because-mocked" />
    );

    expect(
      container.querySelector('source[type="image/avif"]')
    ).not.toBeNull();

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    Object.defineProperty(image as HTMLImageElement, 'currentSrc', {
      configurable: true,
      value: 'https://cdn.example.com/image/format=avif/phone-640.jpg',
    });
    fireEvent.error(image as HTMLImageElement);

    expect(
      container.querySelector('source[type="image/avif"]')
    ).toBeNull();
    expect(container.querySelector('img')).not.toBeNull();
    vi.doUnmock('@/lib/ogabassey-image-format-sources');
  });
});
