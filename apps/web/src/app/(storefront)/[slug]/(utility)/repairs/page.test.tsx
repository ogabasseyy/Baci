import { screen } from '@testing-library/react';
import { connection } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedMerchant } from '@/lib/cached-data';
import { getRepairDevicesForMerchant } from '@/lib/repairs/repairs-catalog-data';

vi.mock('next/server', () => ({ connection: vi.fn() }));

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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCachedMerchant).mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      business_type: 'electronics',
      feature_settings: { repairs_catalog_enabled: true },
    } as Awaited<ReturnType<typeof getCachedMerchant>>);
  });

  it('waits for a real request before reading the uncached catalog', async () => {
    let connected = false;
    vi.mocked(connection).mockImplementation(async () => {
      connected = true;
    });
    vi.mocked(getRepairDevicesForMerchant).mockImplementation(async () => {
      if (!connected) throw new Error('catalog read during prerender');
      return [{ brand: 'Apple', devices: [] }];
    });
    const page = RepairsPage({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });
    const child = page.props.children[1].props.children;
    const result = await child.type(child.props);
    expect(result.props.groups).toEqual([{ brand: 'Apple', devices: [] }]);
  });
  it('prerenders both OgaBassey host identifiers so the lab hero can land in the static shell', () => {
    expect(generateStaticParams()).toEqual([
      { slug: 'ogabassey.com' },
      { slug: 'ogabassey' },
    ]);
  });

  it('keeps the empty-catalog fallback for genuine database failures', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(connection).mockResolvedValue(undefined);
    vi.mocked(getRepairDevicesForMerchant).mockRejectedValue(
      new Error('database unavailable')
    );
    const page = RepairsPage({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });
    const child = page.props.children[1].props.children;
    try {
      const result = await child.type(child.props);
      expect(result.props.groups).toEqual([]);
    } finally {
      errorLog.mockRestore();
    }
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
