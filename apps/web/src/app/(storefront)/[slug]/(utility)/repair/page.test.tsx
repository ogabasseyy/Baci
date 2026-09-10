import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { isValidMerchantIdentifier } from '@/lib/validation';
import { deviceDetail, enabledMerchant } from './repair-page.test-fixtures';

const mockRepairBookingWizard = vi.fn();

vi.mock('@/components/storefront/RepairBookingWizard', () => ({
  RepairBookingWizard: (props: {
    merchantId: string;
    merchantName: string;
    preselection?: unknown;
  }) => {
    mockRepairBookingWizard(props);
    return (
      <div
        data-merchant-id={props.merchantId}
        data-merchant-name={props.merchantName}
      >
        Repair booking wizard
      </div>
    );
  },
}));

const mockGetRepairDeviceDetailBySlug = vi.fn();

vi.mock('@/lib/repairs/repairs-catalog-data', () => ({
  getRepairDeviceDetailBySlug: (...args: unknown[]) =>
    mockGetRepairDeviceDetailBySlug(...args),
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: vi.fn(),
  getCachedMerchantByDomain: vi.fn(async () => null),
}));

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: vi.fn(() => false),
  isValidMerchantIdentifier: vi.fn(() => true),
}));

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

const {
  default: RepairPage,
  generateMetadata,
  generateStaticParams,
} = await import('./page');
const { RepairPageContent } = await import('./repair-page-content');

function callRepairPage(
  slug: string,
  searchParams: Record<string, string> = {}
) {
  return RepairPageContent({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve(searchParams),
  });
}

function callGenerateMetadata(
  slug: string,
  searchParams: Record<string, string> = {}
) {
  return generateMetadata({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve(searchParams),
  });
}

describe('RepairPage', () => {
  beforeEach(() => {
    vi.mocked(getCachedMerchant).mockReset();
    notFound.mockClear();
    mockRepairBookingWizard.mockClear();
    mockGetRepairDeviceDetailBySlug.mockReset();
    mockGetRepairDeviceDetailBySlug.mockResolvedValue(deviceDetail);
  });

  it('prerenders both OgaBassey host identifiers so the booking LCP can land in the static shell', () => {
    expect(generateStaticParams()).toEqual([
      { slug: 'ogabassey.com' },
      { slug: 'ogabassey' },
    ]);
  });

  it('paints the booking LCP copy without waiting for merchant params', () => {
    render(
      <RepairPage
        params={new Promise(() => undefined)}
        searchParams={new Promise(() => undefined)}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Book a Repair Service' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Before you book a repair' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Repair booking wizard')).not.toBeInTheDocument();
  });

  it('renders crawler-visible repair guidance below the booking wizard', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Ogabassey',
      template_id: 'ogabassey',
    } as unknown as Awaited<ReturnType<typeof getCachedMerchant>>);

    const { container } = render(await callRepairPage('ogabassey'));

    expect(
      screen.getByRole('heading', { name: 'Before you book a repair' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/describe the device model, visible damage/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Repair booking wizard')).toHaveAttribute(
      'data-merchant-id',
      'merchant-1'
    );
    expect(mockGetRepairDeviceDetailBySlug).not.toHaveBeenCalled();

    const jsonLd = JSON.parse(
      container.querySelector('script[type="application/ld+json"]')
        ?.textContent ?? '{}'
    ) as { '@type': string; itemListElement: Array<{ name: string }> };

    expect(jsonLd['@type']).toBe('BreadcrumbList');
    expect(jsonLd.itemListElement.map((item) => item.name)).toEqual([
      'Ogabassey',
      'Book a Repair',
    ]);
  });

  it('resolves the device and quote query params into a wizard preselection', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue(enabledMerchant);

    render(
      await callRepairPage('ogabassey', {
        device: 'apple-iphone-13-pro-max',
        quote: '22222222-2222-4222-8222-222222222222',
      })
    );

    expect(mockGetRepairDeviceDetailBySlug).toHaveBeenCalledWith(
      'merchant-1',
      'apple-iphone-13-pro-max'
    );
    expect(mockRepairBookingWizard).toHaveBeenCalledWith(
      expect.objectContaining({
        preselection: expect.objectContaining({
          deviceId: 'device-1',
          deviceLabel: 'Apple iPhone 13 Pro Max',
          quoteId: '22222222-2222-4222-8222-222222222222',
          quoteLabel: 'Screen Replacement',
          quotePrice: 25000,
        }),
      })
    );
  });

  it('renders the booking wizard for generic repairs-catalog merchants', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      ...enabledMerchant,
      business_name: 'Generic Gadgets',
      template_id: 'default',
    });

    render(await callRepairPage('generic-gadgets'));

    expect(screen.getByText('Repair booking wizard')).toHaveAttribute(
      'data-merchant-name',
      'Generic Gadgets'
    );
    expect(notFound).not.toHaveBeenCalled();
  });

  it('preselects the device only when the quote id does not match any active quote', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue(enabledMerchant);

    render(
      await callRepairPage('ogabassey', {
        device: 'apple-iphone-13-pro-max',
        quote: '99999999-9999-4999-8999-999999999999',
      })
    );

    expect(mockRepairBookingWizard).toHaveBeenCalledWith(
      expect.objectContaining({
        preselection: expect.objectContaining({
          deviceId: 'device-1',
          quoteId: undefined,
        }),
      })
    );
  });

  it('falls back to the free-text wizard when the device slug does not resolve', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue(enabledMerchant);
    mockGetRepairDeviceDetailBySlug.mockResolvedValueOnce(null);

    render(await callRepairPage('ogabassey', { device: 'unknown-device' }));

    expect(mockRepairBookingWizard).toHaveBeenCalledWith(
      expect.objectContaining({ preselection: undefined })
    );
  });

  it('skips the catalogue lookup entirely when the repairs flag is off', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      ...enabledMerchant,
      feature_settings: { repairs_catalog_enabled: false },
    });

    render(
      await callRepairPage('ogabassey', { device: 'apple-iphone-13-pro-max' })
    );

    expect(mockGetRepairDeviceDetailBySlug).not.toHaveBeenCalled();
    expect(mockRepairBookingWizard).toHaveBeenCalledWith(
      expect.objectContaining({ preselection: undefined })
    );
  });

  it('ignores a malformed device query param without erroring', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue(enabledMerchant);

    render(await callRepairPage('ogabassey', { device: '../../etc/passwd' }));

    expect(mockGetRepairDeviceDetailBySlug).not.toHaveBeenCalled();
    expect(mockRepairBookingWizard).toHaveBeenCalledWith(
      expect.objectContaining({ preselection: undefined })
    );
  });

  it('returns repair metadata with an absolute title and a useful service description', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      business_name: 'Ogabassey',
      slug: 'ogabassey',
      template_id: 'ogabassey',
    } as unknown as Awaited<ReturnType<typeof getCachedMerchant>>);

    const metadata = await callGenerateMetadata('ogabassey');

    // Absolute so the platform `%s | Baci` template never applies, and
    // distinct from the /repairs landing-page title.
    expect(metadata.title).toEqual({ absolute: 'Book a Repair - Ogabassey' });
    expect(metadata.description).toContain('phone, laptop, console');
    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.usebaci.com/repair'
    );
  });

  it('throws notFound when the merchant is missing', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue(null);

    await expect(callRepairPage('missing')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('throws notFound for merchants that are not on the Ogabassey template', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      id: 'merchant-2',
      business_name: 'Other Store',
      template_id: 'default',
    } as unknown as Awaited<ReturnType<typeof getCachedMerchant>>);

    await expect(callRepairPage('other-store')).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
  });

  it('returns not-found metadata for merchants that are not on the Ogabassey template', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      business_name: 'Other Store',
      slug: 'other-store',
      template_id: 'default',
    } as unknown as Awaited<ReturnType<typeof getCachedMerchant>>);

    const metadata = await callGenerateMetadata('other-store');

    expect(metadata.title).toBe('Store Not Found');
  });

  it('rejects invalid slugs before reaching the cached merchant lookups', async () => {
    vi.mocked(isValidMerchantIdentifier).mockReturnValueOnce(false);

    await expect(callRepairPage('%2525'.repeat(500))).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );

    // The unbounded `'use cache'` keys must never see a bot-supplied slug.
    expect(getCachedMerchant).not.toHaveBeenCalled();
    expect(getCachedMerchantByDomain).not.toHaveBeenCalled();
  });

  it('returns not-found metadata for invalid slugs without a cached lookup', async () => {
    vi.mocked(isValidMerchantIdentifier).mockReturnValueOnce(false);

    const metadata = await callGenerateMetadata('../../etc/passwd');

    expect(metadata.title).toBe('Store Not Found');
    expect(getCachedMerchant).not.toHaveBeenCalled();
  });
});
