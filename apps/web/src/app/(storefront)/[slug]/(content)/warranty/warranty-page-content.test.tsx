import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockNotFound,
  mockGetTrustRouteContext,
  mockHasPublishableWarrantyPolicy,
} = vi.hoisted(() => ({
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  mockGetTrustRouteContext: vi.fn(),
  mockHasPublishableWarrantyPolicy: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: mockNotFound }));
vi.mock('@/components/seo/json-ld', () => ({
  JsonLd: () => <script data-testid="json-ld" />,
}));
vi.mock('@/components/storefront/trust/trust-policy-page-client', () => ({
  TrustPolicyPageClient: ({
    kind,
    merchantName,
  }: {
    kind: string;
    merchantName: string;
  }) => <div data-testid="trust-policy">{`${kind}:${merchantName}`}</div>,
}));
vi.mock('@/lib/storefront-trust/build-merchant-trust-profile', () => ({
  hasPublishableWarrantyPolicy: (...args: unknown[]) =>
    mockHasPublishableWarrantyPolicy(...args),
}));
vi.mock('../trust-route-context', () => ({
  getTrustRouteContext: (...args: unknown[]) =>
    mockGetTrustRouteContext(...args),
  getContactHref: () => 'https://ogabassey.com/contact',
}));

import { WarrantyPageContent } from './warranty-page-content';

describe('WarrantyPageContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls notFound when trust context is missing or warranty is unpublishable', async () => {
    mockGetTrustRouteContext.mockResolvedValueOnce(null);
    await expect(
      WarrantyPageContent({ params: Promise.resolve({ slug: 'missing' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    mockGetTrustRouteContext.mockResolvedValueOnce({
      merchant: { slug: 'ogabassey', business_name: 'Ogabassey' },
      baseUrl: 'https://ogabassey.com',
      trustProfile: {},
    });
    mockHasPublishableWarrantyPolicy.mockReturnValueOnce(false);
    await expect(
      WarrantyPageContent({ params: Promise.resolve({ slug: 'ogabassey' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders warranty policy page when publishable', async () => {
    mockGetTrustRouteContext.mockResolvedValueOnce({
      merchant: { slug: 'ogabassey', business_name: 'Ogabassey' },
      baseUrl: 'https://ogabassey.com',
      trustProfile: { warrantyPolicy: { summary: '12-month warranty' } },
    });
    mockHasPublishableWarrantyPolicy.mockReturnValueOnce(true);

    const node = await WarrantyPageContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });
    render(node);

    expect(screen.getByTestId('json-ld')).toBeInTheDocument();
    expect(screen.getByTestId('trust-policy')).toHaveTextContent(
      'warranty:Ogabassey'
    );
  });
});
