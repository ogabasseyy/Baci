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

// The Privacy page is imported directly by the route; stub it to keep the
// heavy page module out of this test's module graph.
vi.mock('@/components/storefront/ogabassey/pages/privacy-policy', () => ({
  OgabasseyV2PrivacyPolicy: vi.fn(() => null),
}));

vi.mock('../pages/privacy/privacy-page-client', () => ({
  PrivacyPageClient: vi.fn(() => null),
}));

const { generateMetadata } = await import('./page');

describe('privacy metadata', () => {
  beforeEach(() => {
    mockConnection.mockReset();
  });

  it('returns fallback title when merchant is missing', async () => {
    vi.mocked(getMerchantByIdentifier).mockResolvedValue(null);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'unknown' }),
    });

    expect(metadata.title).toBe('Privacy Policy');
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

    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.com/privacy'
    );
    expect(metadata.openGraph?.url).toBe('https://ogabassey.com/privacy');
  });
});
