import { render, screen } from '@testing-library/react';
import { headers } from 'next/headers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMerchantByIdentifier } from '@/lib/cached-data';

const mockConnection = vi.hoisted(() => vi.fn());

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: vi.fn(),
}));

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}));

vi.mock('@/templates/registry', () => ({
  getTemplate: vi.fn(() => null),
}));

// The Terms page is imported directly by the route; stub it to keep the
// heavy page module out of this test's module graph.
vi.mock('@/components/storefront/ogabassey/pages/legal-dispute', () => ({
  OgabasseyV2LegalDispute: vi.fn(() => null),
}));

vi.mock('../pages/terms/terms-page-client', () => ({
  TermsPageClient: vi.fn(() => null),
}));

const { default: TermsPage, generateMetadata } = await import('./page');

beforeEach(() => {
  mockConnection.mockReset();
});

describe('terms metadata', () => {
  it('returns fallback title when merchant is missing', async () => {
    vi.mocked(getMerchantByIdentifier).mockResolvedValue(null);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'unknown' }),
    });

    expect(metadata.title).toBe('Terms of Service');
  });

  it('prefers the request-scoped custom domain for canonical metadata', async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );
    vi.mocked(getMerchantByIdentifier).mockResolvedValue({
      business_name: 'Test Store',
      logo_url: null,
      slug: 'test-store',
      custom_domain: 'ogabassey.com',
    } as unknown as Awaited<ReturnType<typeof getMerchantByIdentifier>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
    });

    expect(metadata.alternates?.canonical).toBe('https://ogabassey.com/terms');
    expect(metadata.openGraph?.url).toBe('https://ogabassey.com/terms');
  });
});

describe('terms page rendering', () => {
  it('returns the route shell without a page-level metadata marker', async () => {
    const element = await TermsPage({
      params: Promise.resolve({ slug: 'ogabassey.com' }),
    });

    render(element);
    expect(
      screen.getByRole('status', { name: /loading page content/i })
    ).toBeInTheDocument();
    expect(mockConnection).not.toHaveBeenCalled();
  });
});
