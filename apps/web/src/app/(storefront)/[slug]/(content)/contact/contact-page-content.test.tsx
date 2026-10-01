import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMerchantByIdentifier } from '@/lib/cached-data';

const mockHeaders = vi.fn();
const mockBuildMerchantTrustProfile = vi.fn();
const mockBuildRequestScopedStoreUrl = vi.fn();
const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}));

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: vi.fn(),
}));

vi.mock('@/lib/merchant-template-data', () => ({
  toTemplateMerchantData: vi.fn((merchant: unknown) => merchant),
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: vi.fn((value: unknown) => JSON.stringify(value)),
}));

vi.mock('@/lib/seo-utils', () => ({
  generateOrganizationSchema: vi.fn(() => ({})),
}));

vi.mock('@/lib/store-url', () => ({
  buildRequestScopedStoreUrl: (...args: unknown[]) =>
    mockBuildRequestScopedStoreUrl(...args),
}));

vi.mock('@/lib/storefront-trust/build-merchant-trust-profile', () => ({
  buildMerchantTrustProfile: (...args: unknown[]) =>
    mockBuildMerchantTrustProfile(...args),
}));

vi.mock('@/templates/registry', () => ({
  getTemplate: vi.fn(() => null),
}));

// The Contact page is imported directly by the route; stub it to keep the
// heavy page module out of this test's module graph.
vi.mock('@/components/storefront/ogabassey/pages/help-support', () => ({
  OgabasseyV2HelpSupport: vi.fn(() => null),
}));

vi.mock('../pages/contact/contact-page-client', () => ({
  ContactPageClient: ({ children }: { children?: ReactNode }) => (
    <div>Contact UI{children}</div>
  ),
}));

const { ContactPageContent } = await import('./contact-page-content');

describe('ContactPageContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers());
    mockBuildRequestScopedStoreUrl.mockReturnValue('https://ogabassey.com');
    mockBuildMerchantTrustProfile.mockReturnValue({
      supportEmail: 'support@ogabassey.com',
      supportPhone: '+2348146978921',
      socialLinks: {},
    });
  });

  it('renders contact UI with crawler-visible support context', async () => {
    vi.mocked(getMerchantByIdentifier).mockResolvedValue({
      business_name: 'Ogabassey',
      slug: 'ogabassey',
      email: 'support@ogabassey.com',
      phone: '+2348146978921',
      pages: { contact: 'Contact us' },
      social_media: {},
      trust_profile: {},
    } as unknown as Awaited<ReturnType<typeof getMerchantByIdentifier>>);

    render(
      await ContactPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.getByText('Contact UI')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Use this contact page when you need help from Ogabassey/i
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /product availability, order status, delivery questions/i
      )
    ).toBeInTheDocument();
  });

  it('throws notFound when the merchant is missing', async () => {
    vi.mocked(getMerchantByIdentifier).mockResolvedValue(null);

    await expect(
      ContactPageContent({
        params: Promise.resolve({ slug: 'missing' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledOnce();
  });
});
