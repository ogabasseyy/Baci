import './critical-shell.test-fixtures';
import { render, screen } from '@testing-library/react';
import { OgabasseyPdpCriticalShell } from './critical-shell';
import { describe, expect, it } from 'vitest';
import {
  defaultProduct,
  isBefore,
  renderCriticalShell,
} from './critical-shell.test-fixtures';

describe('OgabasseyPdpCriticalShell ratings and order', () => {
  it('renders brand, title, rating row, and price in the expected summary DOM order without a duplicate visible summary box', () => {
    const { container } = renderCriticalShell({
      brand: 'Samsung',
      name: 'Samsung Galaxy Z TriFold',
      price: 5_800_000,
      rating: 4.5,
      reviewCount: 10,
    });

    const summary = container.querySelector('[data-ogabassey-pdp-summary]');
    expect(summary).not.toBeNull();

    const brand = summary?.querySelector('[data-ogabassey-pdp-brand]');
    const title = summary?.querySelector('h1[data-ogabassey-pdp-title]');
    const ratingRow = summary?.querySelector('[data-ogabassey-pdp-rating-row]');
    const price = summary?.querySelector('[data-ogabassey-pdp-price]');
    const visibleSummary = summary?.querySelector(
      '[data-ogabassey-pdp-visible-summary]'
    );

    expect(brand).toBeInTheDocument();
    expect(title).toBeInTheDocument();
    expect(ratingRow).toBeInTheDocument();
    expect(price).toBeInTheDocument();
    expect(visibleSummary).toBeNull();

    expect(isBefore(brand, title)).toBe(true);
    expect(isBefore(title, ratingRow)).toBe(true);
    expect(isBefore(ratingRow, price)).toBe(true);
  });

  it('renders summaryCommerce without a redundant visible summary paragraph', () => {
    const { container } = render(
      <OgabasseyPdpCriticalShell
        basePath=""
        product={defaultProduct}
        summaryCommerce={
          <div data-testid="summary-commerce">Commerce Options</div>
        }
      />
    );

    const summary = container.querySelector('[data-ogabassey-pdp-summary]');
    const commerce = summary?.querySelector('[data-testid="summary-commerce"]');
    const visibleSummary = summary?.querySelector(
      '[data-ogabassey-pdp-visible-summary]'
    );

    expect(commerce).toBeInTheDocument();
    expect(visibleSummary).toBeNull();
  });

  it('shows review count without a rating signal when rating is zero', () => {
    renderCriticalShell({ rating: 0, reviewCount: 3 });

    expect(screen.getByText('3 Reviews')).toBeInTheDocument();
    expect(screen.queryByLabelText(/out of 5 stars/i)).not.toBeInTheDocument();
  });

  it('clamps rendered rating values to the valid five-star range', () => {
    const { rerender } = renderCriticalShell({ rating: 5, reviewCount: 3 });

    expect(
      screen.getByRole('img', { name: '5 out of 5 stars' })
    ).toBeInTheDocument();

    rerender(
      <OgabasseyPdpCriticalShell
        basePath=""
        product={{ ...defaultProduct, rating: 5.8, reviewCount: 3 }}
      />
    );

    expect(
      screen.getByRole('img', { name: '5 out of 5 stars' })
    ).toBeInTheDocument();

    rerender(
      <OgabasseyPdpCriticalShell
        basePath=""
        product={{ ...defaultProduct, rating: -1, reviewCount: 3 }}
      />
    );

    expect(screen.queryByLabelText(/out of 5 stars/i)).not.toBeInTheDocument();
  });

  it('renders the star row for a rating-only product without counts', () => {
    renderCriticalShell({ rating: 4.5, ratingCount: 0, reviewCount: 0 });

    expect(
      screen.getByRole('img', { name: '4.5 out of 5 stars' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 Ratings/)).not.toBeInTheDocument();
  });
});
