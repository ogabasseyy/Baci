import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockNotFound, mockGetTrustRouteContext } = vi.hoisted(() => ({
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  mockGetTrustRouteContext: vi.fn(),
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
vi.mock('../trust-route-context', () => ({
  getTrustRouteContext: (...args: unknown[]) =>
    mockGetTrustRouteContext(...args),
  getContactHref: () => 'https://ogabassey.com/contact',
}));

import { ReturnsPageContent } from './returns-page-content';

describe('ReturnsPageContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls notFound when trust context is missing', async () => {
    mockGetTrustRouteContext.mockResolvedValueOnce(null);
    await expect(
      ReturnsPageContent({ params: Promise.resolve({ slug: 'missing' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders returns policy page with JsonLd', async () => {
    mockGetTrustRouteContext.mockResolvedValueOnce({
      merchant: {
        slug: 'ogabassey',
        business_name: 'Ogabassey',
        logo_url: 'https://ogabassey.com/logo.png',
      },
      baseUrl: 'https://ogabassey.com',
      trustProfile: { returnPolicy: { summary: '7-day returns' } },
    });

    const node = await ReturnsPageContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });
    render(node);

    expect(screen.getByTestId('json-ld')).toBeInTheDocument();
    expect(screen.getByTestId('trust-policy')).toHaveTextContent(
      'returns:Ogabassey'
    );
  });
});
