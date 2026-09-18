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

  it('renders inside a picture wrapper or as a plain image', () => {
    const { container } = render(
      <HomeProductGridFallbackImage alt="" src="https://example.com/x.jpg" />
    );

    // Non-CDN sources have no AVIF tier and render the plain <img> the
    // interactive card renders; CDN sources add the <picture> wrapper.
    expect(container.querySelector('picture, img')).not.toBeNull();
  });
});
