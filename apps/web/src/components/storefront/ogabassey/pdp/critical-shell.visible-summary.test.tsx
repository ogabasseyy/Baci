import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OgabasseyPdpCriticalShell } from './critical-shell';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

describe('OgabasseyPdpCriticalShell visible summary', () => {
  it('keeps the server-computed visible summary near the primary product information', () => {
    const { container } = render(
      <OgabasseyPdpCriticalShell
        basePath=""
        product={{
          brand: 'Samsung',
          categoryName: 'Smartphones',
          categorySlug: 'smartphones',
          condition: 'new',
          id: 'product-1',
          image:
            'https://cdn.ogabassey.com/core-assets/products/galaxy-trifold.avif',
          imageVersion: 'lcpv1',
          name: 'Samsung Galaxy Z TriFold',
          price: 5_800_000,
          rating: 0,
          ratingCount: 0,
          reviewCount: 0,
          slug: 'samsung-galaxy-z-trifold',
          stockQuantity: 3,
          visibleSummary:
            'Samsung Galaxy Z TriFold. Available choices: Storage 512 GB or 1 TB.',
        }}
      />
    );

    const summary = screen.getByText(
      'Samsung Galaxy Z TriFold. Available choices: Storage 512 GB or 1 TB.'
    );

    expect(summary).toBeVisible();
    expect(summary.closest('[data-ogabassey-pdp-summary]')).not.toBeNull();
    expect(
      container.querySelector('[data-ogabassey-pdp-commerce-slot]')?.contains(
        summary
      )
    ).toBe(false);
    expect(container.querySelector('article[aria-label*="summary"]')).toBeNull();

    const price = container.querySelector('[data-ogabassey-pdp-price]');
    expect(price).not.toBeNull();
    expect(
      Boolean(
        price &&
          price.compareDocumentPosition(summary) &
            Node.DOCUMENT_POSITION_FOLLOWING
      )
    ).toBe(true);
  });
});
