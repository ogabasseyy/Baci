import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProductDetailsBannerSection } from './product-details-banner-section';

vi.mock('./product-details-lazy-banner-carousel', () => ({
  BannerCarousel: ({ className }: { className?: string }) => (
    <div
      role="region"
      aria-label="Promotional banners"
      className={className}
    />
  ),
}));

describe('ProductDetailsBannerSection', () => {
  it('renders the banner carousel on desktop viewports', () => {
    render(<ProductDetailsBannerSection isDesktop />);

    expect(
      screen.getByRole('region', { name: 'Product banner carousel' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Promotional banners' })
    ).toBeInTheDocument();
  });

  it('keeps the banner section without mounting the carousel on non-desktop viewports', () => {
    render(<ProductDetailsBannerSection isDesktop={false} />);

    expect(
      screen.getByRole('region', { name: 'Product banner carousel' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Promotional banners' })
    ).not.toBeInTheDocument();
  });
});
