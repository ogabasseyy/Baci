import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getRequestScopedMerchant } from '@/lib/cached-data';

const mockHeaders = vi.fn();
const mockBuildMerchantTrustProfile = vi.fn();
const mockBuildRequestScopedStoreUrl = vi.fn();
const mockSafeJsonLdStringify = vi.fn(() => '{}');
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
  safeJsonLdStringify: () => mockSafeJsonLdStringify(),
}));

const trustMerchant = {
  business_name: 'Ogabassey',
  slug: 'ogabassey',
  trust_profile: {
    return_policy: {
      summary: 'Returns accepted for defective items.',
      window_days: 7,
      return_method: 'mail',
      return_fees: 'free',
    },
  },
  updated_at: '2026-01-01T00:00:00.000Z',
  logo_url: null,
} as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>;

describe('returns page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers([['x-custom-domain', '']]));
    mockBuildRequestScopedStoreUrl.mockReturnValue('https://ogabassey.com');
    mockBuildMerchantTrustProfile.mockReturnValue({
      returnPolicy: {
        summary: 'Returns accepted for defective items.',
        windowDays: 7,
        returnMethod: 'mail',
        returnFees: 'free',
        localRoute: '/returns',
      },
      socialLinks: {},
      derivedLinks: { contact: 'https://ogabassey.com/contact' },
    });
  });

  it('returns canonical metadata for a merchant with a return policy', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(trustMerchant);
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.com/returns'
    );
  });

  it('renders when the return summary exists', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(trustMerchant);
    const { ReturnsPageContent } = await import('./returns-page-content');

    render(
      await ReturnsPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(mockBuildMerchantTrustProfile).toHaveBeenCalledWith(
      trustMerchant,
      'https://ogabassey.com'
    );
    expect(
      screen.getByRole('heading', { name: 'Returns Policy' })
    ).toBeInTheDocument();
  });

  it('renders the contact CTA when the storefront contact route exists', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...trustMerchant,
      pages: { contact: 'Contact' },
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);
    const { ReturnsPageContent } = await import('./returns-page-content');

    render(
      await ReturnsPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.getByRole('link', { name: /contact us/i })).toHaveAttribute(
      'href',
      'https://ogabassey.com/contact'
    );
  });

  it('renders when only the return window exists', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...trustMerchant,
      trust_profile: {
        return_policy: {
          window_days: 14,
        },
      },
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);
    mockBuildMerchantTrustProfile.mockReturnValue({
      returnPolicy: {
        windowDays: 14,
        localRoute: '/returns',
      },
      socialLinks: {},
      derivedLinks: { contact: 'https://ogabassey.com/contact' },
    });
    const { ReturnsPageContent } = await import('./returns-page-content');

    render(
      await ReturnsPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.getByText('14 days')).toBeInTheDocument();
  });

  it('returns canonical fallback metadata when no return content is present', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...trustMerchant,
      trust_profile: {
        return_policy: {},
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
      'https://ogabassey.com/returns'
    );
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('renders fallback policy content when no return content is present', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...trustMerchant,
      trust_profile: {
        return_policy: {},
      },
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);
    mockBuildMerchantTrustProfile.mockReturnValue({
      socialLinks: {},
      derivedLinks: {},
    });
    const { ReturnsPageContent } = await import('./returns-page-content');

    render(
      await ReturnsPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(
      screen.getByRole('heading', { name: 'Returns Policy' })
    ).toBeInTheDocument();
    expect(screen.getAllByText('Not specified').length).toBeGreaterThan(0);
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('renders when only return method or fees exist', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...trustMerchant,
      trust_profile: {
        return_policy: {
          return_method: 'mail',
          return_fees: 'free',
        },
      },
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);
    mockBuildMerchantTrustProfile.mockReturnValue({
      returnPolicy: {
        returnMethod: 'mail',
        returnFees: 'free',
        localRoute: '/returns',
      },
      socialLinks: {},
      derivedLinks: { contact: 'https://ogabassey.com/contact' },
    });
    const { ReturnsPageContent } = await import('./returns-page-content');

    render(
      await ReturnsPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.getByText('Mail')).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
  });

  it('omits the contact CTA when the merchant has only support contact data', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...trustMerchant,
      pages: {},
      email: null,
      phone: null,
      trust_profile: {
        support_email: 'support@ogabassey.com',
        support_phone: '+2348000000000',
        return_policy: {
          summary: 'Returns accepted for defective items.',
          window_days: 7,
        },
      },
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);
    mockBuildMerchantTrustProfile.mockReturnValue({
      returnPolicy: {
        summary: 'Returns accepted for defective items.',
        windowDays: 7,
        localRoute: '/returns',
      },
      socialLinks: {},
      derivedLinks: {},
    });
    const { ReturnsPageContent } = await import('./returns-page-content');

    render(
      await ReturnsPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(
      screen.queryByRole('link', { name: /contact us/i })
    ).not.toBeInTheDocument();
  });
});
