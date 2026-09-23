import { screen } from '@testing-library/react';
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

  it('does not await params in the page — the committed hero does', () => {
    const then = vi.fn(() => {
      throw new Error('params read outside boundary');
    });
    const params = { then } as unknown as Promise<{ slug: string }>;
    const ui = RepairsPage({ params });

    expect(ui.props.children[0].props.params).toBe(params);
    expect(then).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('heading', { name: 'Repair Lab' })
    ).not.toBeInTheDocument();
  });
});
