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

describe('OgabasseyPdpCriticalShell visible summary omission', () => {
  it('omits the redundant visible summary paragraph even if a legacy payload includes visibleSummary', () => {
    const productWithLegacySummary = {
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
    };
    const { container } = render(
      <OgabasseyPdpCriticalShell
        basePath=""
        product={productWithLegacySummary}
      />
    );

    expect(
      screen.queryByText(
        'Samsung Galaxy Z TriFold. Available choices: Storage 512 GB or 1 TB.'
      )
    ).toBeNull();
    expect(
      container.querySelector('[data-ogabassey-pdp-visible-summary]')
    ).toBeNull();
    expect(container.querySelector('article[aria-label*="summary"]')).toBeNull();
  });
});
