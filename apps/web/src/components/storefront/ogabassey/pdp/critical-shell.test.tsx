import './critical-shell.test-fixtures';
import { render, screen } from '@testing-library/react';
import { OgabasseyPdpCriticalShell } from './critical-shell';
import { describe, expect, it } from 'vitest';
import {
  defaultProduct,
  isBefore,
  renderCriticalShell,
} from './critical-shell.test-fixtures';

describe('OgabasseyPdpCriticalShell', () => {
  it('renders one server-owned product heading and high-priority image', () => {
    const { container } = renderCriticalShell(
      {
        brand: 'Lenovo',
        categoryName: 'Laptops',
        categorySlug: 'laptops',
        condition: 'used',
        id: 'product-1',
        image: 'https://cdn.ogabassey.com/core-assets/products/legion.avif',
        name: 'Lenovo Legion Pro 9',
        price: 5_985_000,
        rating: 4.5,
        reviewCount: 12,
        slug: 'lenovo-legion-pro-9',
      },
      <button type="button">Add to Cart</button>
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Lenovo Legion Pro 9' })
    ).toBeInTheDocument();
    const productImage = screen.getByRole('img', {
      name: 'Lenovo Legion Pro 9',
    });

    // The critical image renders through the real per-format <picture> path
    // (CdnFormatImage + getImageProps), so assert REAL DOM attributes — not the
    // next/image test-double's data-* markers.
    expect(productImage).toHaveAttribute('fetchpriority', 'high');
    expect(productImage).toHaveAttribute('loading', 'eager');
    const picture = productImage.closest('picture');
    expect(picture).not.toBeNull();
    expect(
      picture?.querySelector('source[type="image/avif"]')
    ).not.toBeNull();
    expect(productImage).not.toHaveAttribute('loader');
    expect(productImage).not.toHaveAttribute('priority');
    expect(productImage).not.toHaveAttribute('quality');
    expect(productImage).not.toHaveAttribute('fill');
    // Exactly ONE <source>: the AVIF tier asserted above — no stray extras.
    expect(document.querySelectorAll('source')).toHaveLength(1);
    expect(productImage).toHaveAttribute(
      'sizes',
      '(max-width: 767.98px) calc(100vw - 32px), (max-width: 1023px) calc(100vw - 48px), (max-width: 1439px) 40vw, 560px'
    );
    expect(screen.getByRole('link', { name: 'Laptops' })).toHaveAttribute(
      'href',
      '/laptops'
    );
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'data-prefetch',
      'false'
    );
    expect(screen.getByRole('link', { name: 'Laptops' })).toHaveAttribute(
      'data-prefetch',
      'false'
    );
    expect(
      screen.getByRole('button', { name: 'Add to Cart' })
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-ogabassey-pdp-summary-variant-slot]')
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-ogabassey-pdp-price-live]')
    ).not.toBeInTheDocument();
  });

  it('formats the static price in NGN by default', () => {
    renderCriticalShell({ price: 999_900 });
    expect(screen.getByText('₦999,900')).toBeInTheDocument();
  });

  it('formats the static price in the merchant-resolved currency when supplied', () => {
    const { container } = render(
      <OgabasseyPdpCriticalShell
        basePath=""
        currency={{ code: 'INR', symbol: '₹', locale: 'en-IN' }}
        product={{ ...defaultProduct, price: 999_900 }}
      />
    );

    expect(screen.getByText('₹9,99,900')).toBeInTheDocument();
    expect(
      container.querySelector('[data-ogabassey-pdp-price-static]')
    ).toHaveTextContent('₹9,99,900');
  });

  it('renders summary commerce content natively in the product summary', () => {
    const { container } = render(
      <OgabasseyPdpCriticalShell
        basePath=""
        product={defaultProduct}
        summaryCommerce={
          <div data-testid="native-summary-commerce">Variant controls</div>
        }
      >
        <button type="button">Add to Cart</button>
      </OgabasseyPdpCriticalShell>
    );

    expect(screen.getByTestId('native-summary-commerce')).toBeInTheDocument();
    expect(
      container.querySelector('[data-ogabassey-pdp-price-static]')
    ).not.toBeInTheDocument();
  });

  it('omits the rating row and "No reviews yet" copy when a product has no reviews or ratings', () => {
    const { container } = renderCriticalShell({
      rating: 0,
      ratingCount: 0,
      reviewCount: 0,
    });

    expect(
      container.querySelector('[data-ogabassey-pdp-rating-row]')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('No reviews yet')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/out of 5 stars/i)).not.toBeInTheDocument();
    expect(screen.queryByText('★★★★★')).not.toBeInTheDocument();
  });

  it('renders an honest rating signal for products with reviews', () => {
    renderCriticalShell({ rating: 4.5, reviewCount: 25 });

    expect(
      screen.getByRole('img', { name: '4.5 out of 5 stars' })
    ).toBeInTheDocument();
    expect(screen.getByText('4.5 ★')).toBeInTheDocument();
    expect(screen.getByText('25 Reviews')).toBeInTheDocument();
    expect(screen.queryByText('★★★★★')).not.toBeInTheDocument();
  });

  it('uses singular review copy for one review', () => {
    renderCriticalShell({ rating: 4, reviewCount: 1 });

    expect(screen.getByText('1 Review')).toBeInTheDocument();
  });

  it('renders rating-count-only aggregate ratings as ratings, not reviews', () => {
    const { rerender } = renderCriticalShell({
      rating: 4.5,
      ratingCount: 12,
      reviewCount: 0,
    });

    expect(
      screen.getByRole('img', { name: '4.5 out of 5 stars' })
    ).toBeInTheDocument();
    expect(screen.getByText('12 Ratings')).toBeInTheDocument();
    expect(screen.queryByText('No reviews yet')).not.toBeInTheDocument();
    expect(screen.queryByText('12 Reviews')).not.toBeInTheDocument();

    rerender(
      <OgabasseyPdpCriticalShell
        basePath=""
        product={{
          ...defaultProduct,
          rating: 4,
          ratingCount: 1,
          reviewCount: 0,
        }}
      />
    );

    expect(
      screen.getByRole('img', { name: '4 out of 5 stars' })
    ).toBeInTheDocument();
    expect(screen.getByText('1 Rating')).toBeInTheDocument();
  });

  it('displays review count when both reviews and ratings exist', () => {
    renderCriticalShell({ rating: 4.5, ratingCount: 12, reviewCount: 5 });

    expect(
      screen.getByRole('img', { name: '4.5 out of 5 stars' })
    ).toBeInTheDocument();
    expect(screen.getByText('5 Reviews')).toBeInTheDocument();
    expect(screen.queryByText('12 Ratings')).not.toBeInTheDocument();
  });

});
