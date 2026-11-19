import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockReadStorefrontMerchantSnapshot } = vi.hoisted(() => ({
  mockReadStorefrontMerchantSnapshot: vi.fn(),
}));
const mockMaybeSingle = vi.fn();
const query = {
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: mockMaybeSingle,
};
query.select.mockReturnValue(query);
query.eq.mockReturnValue(query);

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => ({
    from: () => query,
  }),
}));
vi.mock('@/lib/storefront-merchant-snapshot', () => ({
  readStorefrontMerchantSnapshot: mockReadStorefrontMerchantSnapshot,
}));

import { cacheTag } from 'next/cache';
import { brandAuthorityPublicData } from '@/lib/storefront-category/brand-authority-public-data';

describe('brandAuthorityPublicData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
  });

  it('resolves only the public merchant fields needed by authority pages', async () => {
    mockReadStorefrontMerchantSnapshot.mockResolvedValue({
      status: 'found',
      value: {
        custom_domain: 'store.example',
        resolution_status: 'found',
        merchant_data: {
          business_name: 'Store',
          country: 'NG',
          id: 'merchant-1',
          payout_currency: 'NGN',
          slug: 'store',
        },
        feature_settings: null,
      },
    });

    await expect(
      brandAuthorityPublicData.getMerchant('STORE')
    ).resolves.toEqual({
      business_name: 'Store',
      country: 'NG',
      custom_domain: 'store.example',
      id: 'merchant-1',
      payout_currency: 'NGN',
      slug: 'store',
    });
    expect(mockReadStorefrontMerchantSnapshot).toHaveBeenCalledWith(
      expect.any(Object),
      'store'
    );
    expect(vi.mocked(cacheTag).mock.calls.flat()).toEqual(
      expect.arrayContaining([
        'merchant-id-merchant-1',
        'merchant-store',
        'merchant-slug-store',
        'domain-store.example',
      ])
    );
  });

  it('returns null when the bounded snapshot reader reports not found', async () => {
    mockReadStorefrontMerchantSnapshot.mockResolvedValue({
      status: 'not_found',
    });

    await expect(
      brandAuthorityPublicData.getMerchant('missing-store')
    ).resolves.toBeNull();
  });

  it.each([
    'images',
    `invalid-${'x'.repeat(300)}`,
  ])('rejects invalid merchant identifier %s before the cached RPC lookup', async (identifier) => {
    await expect(
      brandAuthorityPublicData.getMerchant(identifier)
    ).resolves.toBeNull();

    expect(mockReadStorefrontMerchantSnapshot).not.toHaveBeenCalled();
  });

  it('returns only active, valid public categories', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: 'category-1', is_active: true, name: 'Smartphones' },
      error: null,
    });

    await expect(
      brandAuthorityPublicData.getCategory('merchant-1', 'smartphones')
    ).resolves.toEqual({ id: 'category-1', name: 'Smartphones' });

    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'category-1', is_active: false, name: 'Smartphones' },
      error: null,
    });
    await expect(
      brandAuthorityPublicData.getCategory('merchant-1', 'smartphones')
    ).resolves.toBeNull();
  });
});
