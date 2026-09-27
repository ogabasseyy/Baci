import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

  it('renders a plain image with no AVIF tier and no client behavior', () => {
    // The SSR fallback is the entire product image for no-JS readers and
    // pre-hydration browsers: an AVIF <source> could fail before any
    // recovery attaches, so the fallback emits the JPEG <img> only.
    const { container } = render(
      <HomeProductGridFallbackImage
        alt="Phone"
        src="https://cdn.example.com/image/format=jpeg/phone-640.jpg"
      />
    );

    expect(container.querySelector('picture')).toBeNull();
    expect(
      container.querySelector('source[type="image/avif"]')
    ).toBeNull();
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toContain('format=jpeg');
  });
});
