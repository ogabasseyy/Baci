import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: () => null,
  })),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
}));

vi.mock('@/components/seo/json-ld', () => ({
  JsonLd: () => null,
}));

vi.mock('@/components/storefront/ogabassey/pages/repairs', () => ({
  OgabasseyV2Repairs: () => null,
}));

vi.mock('@/components/storefront/repairs/GenericRepairsPage', () => ({
  GenericRepairsPage: () => null,
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: vi.fn(),
  getCachedMerchantByDomain: vi.fn(),
}));

vi.mock('@/lib/repairs/repairs-catalog-data', () => ({
  getRepairDevicesForMerchant: vi.fn(),
}));

const { default: RepairsPage, generateStaticParams } = await import('./page');

describe('RepairsPage static params', () => {
  it('prerenders both OgaBassey host identifiers so the lab hero can land in the static shell', () => {
    expect(generateStaticParams()).toEqual([
      { slug: 'ogabassey.com' },
      { slug: 'ogabassey' },
    ]);
  });

  it('paints the repair lab LCP copy without waiting for merchant params', () => {
    render(<RepairsPage params={new Promise(() => undefined)} />);

    expect(
      screen.getByRole('heading', { name: 'Repair Lab' })
    ).toBeInTheDocument();
    expect(screen.getByText(/Don't Ditch It/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Every device repaired is one less in a landfill/i)
    ).toBeInTheDocument();
  });
});
