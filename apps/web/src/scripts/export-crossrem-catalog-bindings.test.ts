import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveFeedMerchant: vi.fn(),
  getGoogleMerchantFeedData: vi.fn(),
  collectGoogleMerchantListings: vi.fn(),
  seedBindingCandidates:
    vi.fn<typeof import('@/app/api/partners/v1/catalog/seed-bindings').seedBindingCandidates>(),
}));

vi.mock('@/lib/feed-identifier', () => ({
  isUuid: (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    ),
  resolveFeedMerchant: mocks.resolveFeedMerchant,
}));

vi.mock('@/app/api/feed/google-merchant/feed-data', () => ({
  getGoogleMerchantFeedData: mocks.getGoogleMerchantFeedData,
}));

vi.mock(
  '@/app/api/feed/google-merchant/collect-google-merchant-listings',
  () => ({
    collectGoogleMerchantListings: mocks.collectGoogleMerchantListings,
  })
);

vi.mock('@/app/api/partners/v1/catalog/seed-bindings', () => ({
  seedBindingCandidates: mocks.seedBindingCandidates,
}));

import { exportCrossRemCatalogBindings } from './export-crossrem-catalog-bindings';

const VALID_MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const seedResult = {
  bindings: [
    {
      listingId: 'prod-1',
      productId: 'prod-1',
      variantId: 'var-1',
      condition: 'new' as const,
    },
  ],
  unresolved_listing_ids: ['unresolved-1'],
};

describe('exportCrossRemCatalogBindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveFeedMerchant.mockResolvedValue({
      id: VALID_MERCHANT_ID,
      slug: 'ogabassey',
      country: 'NG',
      payout_currency: 'NGN',
      gmc_variants_enabled: false,
    });
    mocks.getGoogleMerchantFeedData.mockResolvedValue({
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      products: [{ id: 'prod-1' }],
      imageManifest: {},
    });
    mocks.collectGoogleMerchantListings.mockReturnValue([
      {
        product: { id: 'prod-1' },
        variant: { id: 'var-1' },
      },
    ]);
    mocks.seedBindingCandidates.mockReturnValue(seedResult);
  });

  it('rejects non-UUID merchant identifiers', async () => {
    await expect(exportCrossRemCatalogBindings('not-a-uuid')).rejects.toThrow(
      'Pass the approved merchant UUID.'
    );
    expect(mocks.resolveFeedMerchant).not.toHaveBeenCalled();
  });

  it('rejects mismatched merchant identity or non-NGN currency', async () => {
    mocks.resolveFeedMerchant.mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000001',
      slug: 'other',
      country: 'NG',
    });
    await expect(
      exportCrossRemCatalogBindings(VALID_MERCHANT_ID)
    ).rejects.toThrow('Resolved merchant does not match');

    mocks.resolveFeedMerchant.mockResolvedValueOnce({
      id: VALID_MERCHANT_ID,
      slug: 'ghana',
      country: 'GH',
      payout_currency: 'GHS',
    });
    await expect(
      exportCrossRemCatalogBindings(VALID_MERCHANT_ID)
    ).rejects.toThrow('CrossRem catalog pricing requires NGN.');
  });

  it('rejects empty listing output', async () => {
    mocks.collectGoogleMerchantListings.mockReturnValueOnce([]);
    await expect(
      exportCrossRemCatalogBindings(VALID_MERCHANT_ID)
    ).rejects.toThrow('no eligible Google listings');
  });

  it('preserves Google family mode and returns unresolved Google IDs', async () => {
    const result = await exportCrossRemCatalogBindings(VALID_MERCHANT_ID);

    expect(mocks.collectGoogleMerchantListings).toHaveBeenCalledWith(
      [{ id: 'prod-1' }],
      expect.objectContaining({
        id: VALID_MERCHANT_ID,
        gmc_variants_enabled: false,
      }),
      'https://ogabassey.com',
      {}
    );
    expect(result).toEqual({
      merchant_id: VALID_MERCHANT_ID,
      ...seedResult,
    });
  });
});
