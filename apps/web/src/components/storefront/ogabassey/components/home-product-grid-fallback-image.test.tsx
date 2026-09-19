import { render, screen } from '@testing-library/react';
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

  it('marks the image for delegated AVIF recovery instead of hydrating a handler', async () => {
    // The fallback is server-rendered zero-JS: AVIF-tier recovery runs in
    // the already-client gate's capture-phase listener, scoped by
    // data-avif-recover, so this module never joins the client payload.
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
    expect(container.querySelector('img')).toHaveAttribute(
      'data-avif-recover',
      ''
    );
    vi.doUnmock('@/lib/ogabassey-image-format-sources');
  });
});
