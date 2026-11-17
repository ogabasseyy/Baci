import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetRequestScopedMerchant,
  mockBuildStoreUrl,
  mockBuildTrustProfile,
} = vi.hoisted(() => ({
  mockGetRequestScopedMerchant: vi.fn(),
  mockBuildStoreUrl: vi.fn(),
  mockBuildTrustProfile: vi.fn(),
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: (...args: unknown[]) =>
    mockGetRequestScopedMerchant(...args),
}));
vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: (...args: unknown[]) => mockBuildStoreUrl(...args),
}));
vi.mock('@/lib/storefront-trust/build-merchant-trust-profile', () => ({
  buildMerchantTrustProfile: (...args: unknown[]) =>
    mockBuildTrustProfile(...args),
}));

import { getContactHref, getTrustRouteContext } from './trust-route-context';

describe('trust-route-context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when merchant is not found', async () => {
    mockGetRequestScopedMerchant.mockResolvedValueOnce(null);
    await expect(getTrustRouteContext('missing')).resolves.toBeNull();
  });

  it('builds store URL and trust profile for a found merchant', async () => {
    const merchant = {
      id: 'm1',
      slug: 'ogabassey',
      business_name: 'Ogabassey',
    };
    const trustProfile = { returnPolicy: { summary: '7 days' } };
    mockGetRequestScopedMerchant.mockResolvedValueOnce(merchant);
    mockBuildStoreUrl.mockReturnValueOnce('https://ogabassey.com');
    mockBuildTrustProfile.mockReturnValueOnce(trustProfile);

    await expect(getTrustRouteContext('ogabassey')).resolves.toEqual({
      merchant,
      baseUrl: 'https://ogabassey.com',
      trustProfile,
    });
  });

  it('returns contact href only when contact page, email, or phone exists', () => {
    expect(
      getContactHref({ email: 'hi@example.com' } as never, 'https://shop.com')
    ).toBe('https://shop.com/contact');
    expect(
      getContactHref({ pages: { contact: '' } } as never, 'https://shop.com')
    ).toBeUndefined();
  });
});
