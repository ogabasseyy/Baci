import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getRequestScopedMerchant } from '@/lib/cached-data';

const mockHeaders = vi.fn();
const mockBuildMerchantTrustProfile = vi.fn();
const mockBuildRequestScopedStoreUrl = vi.fn();
const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const mockConnection = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}));

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(),
}));

vi.mock(
  '@/lib/storefront-trust/build-merchant-trust-profile',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/lib/storefront-trust/build-merchant-trust-profile')
      >();

    return {
      ...actual,
      buildMerchantTrustProfile: (merchant: unknown, baseUrl?: string) =>
        mockBuildMerchantTrustProfile(merchant, baseUrl),
    };
  }
);

vi.mock('@/lib/store-url', () => ({
  buildRequestScopedStoreUrl: (merchant: unknown, requestHeaders: Headers) =>
    mockBuildRequestScopedStoreUrl(merchant, requestHeaders),
  buildStoreUrl: () => 'https://ogabassey.com',
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: vi.fn(() => '{}'),
}));

const trustMerchant = {
  business_name: 'Ogabassey',
  slug: 'ogabassey',
  trust_profile: {
    shipping_policy: {
      summary: 'Nationwide delivery available.',
      regions: ['Nigeria', 'Ghana'],
      handling_days_min: 0,
      handling_days_max: 1,
      transit_days_min: 1,
      transit_days_max: 5,
      shipping_fee_type: 'calculated',
    },
  },
  updated_at: '2026-01-01T00:00:00.000Z',
  logo_url: null,
} as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>;

describe('shipping page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers());
    mockBuildRequestScopedStoreUrl.mockReturnValue('https://ogabassey.com');
    mockBuildMerchantTrustProfile.mockReturnValue({
      shippingPolicy: {
        summary: 'Nationwide delivery available.',
        regions: ['Nigeria', 'Ghana'],
        handlingDaysMin: 0,
        handlingDaysMax: 1,
        transitDaysMin: 1,
        transitDaysMax: 5,
        shippingFeeType: 'calculated',
        localRoute: '/shipping',
      },
      socialLinks: {},
      derivedLinks: { contact: 'https://ogabassey.com/contact' },
    });
  });

  it('returns canonical metadata for a merchant with a shipping policy', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(trustMerchant);
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.com/shipping'
    );
  });

  it('renders when the shipping summary exists', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(trustMerchant);
    const { ShippingPageContent } = await import('./shipping-page-content');

    render(
      await ShippingPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(mockBuildMerchantTrustProfile).toHaveBeenCalledWith(
      trustMerchant,
      'https://ogabassey.com'
    );
    expect(
      screen.getByRole('heading', { name: 'Shipping Policy' })
    ).toBeInTheDocument();
  });

  it('throws not found when the trust route context is unavailable', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(null);
    const { ShippingPageContent } = await import('./shipping-page-content');

    await expect(
      ShippingPageContent({
        params: Promise.resolve({ slug: 'missing-store' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledOnce();
  });

  it('renders when only shipping regions exist', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...trustMerchant,
      trust_profile: {
        shipping_policy: {
          regions: ['Nigeria'],
        },
      },
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);
    mockBuildMerchantTrustProfile.mockReturnValue({
      shippingPolicy: {
        regions: ['Nigeria'],
        localRoute: '/shipping',
      },
      socialLinks: {},
      derivedLinks: { contact: 'https://ogabassey.com/contact' },
    });
    const { ShippingPageContent } = await import('./shipping-page-content');

    render(
      await ShippingPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.getByText('Nigeria')).toBeInTheDocument();
  });

  it('returns canonical fallback metadata when no shipping content is present', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...trustMerchant,
      trust_profile: {
        shipping_policy: {},
      },
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);
    mockBuildMerchantTrustProfile.mockReturnValue({
      socialLinks: {},
      derivedLinks: {},
    });
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.com/shipping'
    );
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('renders fallback policy content when no shipping content is present', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...trustMerchant,
      trust_profile: {
        shipping_policy: {},
      },
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);
    mockBuildMerchantTrustProfile.mockReturnValue({
      socialLinks: {},
      derivedLinks: {},
    });
    const { ShippingPageContent } = await import('./shipping-page-content');

    render(
      await ShippingPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(
      screen.getByRole('heading', { name: 'Shipping Policy' })
    ).toBeInTheDocument();
    expect(screen.getAllByText('Not specified').length).toBeGreaterThan(0);
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('renders when only handling or shipping fee details exist', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...trustMerchant,
      trust_profile: {
        shipping_policy: {
          handling_days_min: 0,
          transit_days_min: 1,
          shipping_fee_type: 'calculated',
        },
      },
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);
    mockBuildMerchantTrustProfile.mockReturnValue({
      shippingPolicy: {
        handlingDaysMin: 0,
        transitDaysMin: 1,
        shippingFeeType: 'calculated',
        localRoute: '/shipping',
      },
      socialLinks: {},
      derivedLinks: { contact: 'https://ogabassey.com/contact' },
    });
    const { ShippingPageContent } = await import('./shipping-page-content');

    render(
      await ShippingPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.getByText('0 business days')).toBeInTheDocument();
    expect(screen.getByText('Calculated')).toBeInTheDocument();
  });
});
