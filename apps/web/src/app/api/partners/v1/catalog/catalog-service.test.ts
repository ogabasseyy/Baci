import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCrossRemCatalog } from './catalog-service';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  warn: vi.fn(),
  resolveMerchant: vi.fn(),
  getFeedData: vi.fn(),
  bindings: [
    { listingId: 'legacy-id', productId: 'item', condition: 'used' },
  ] as Array<{
    listingId: string;
    productId: string;
    condition: string;
    variantId?: string;
    retired?: boolean;
  }>,
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: mocks.warn } }));
vi.mock('@/lib/feed-identifier', () => ({
  resolveFeedMerchant: mocks.resolveMerchant,
}));
vi.mock('@/app/api/feed/google-merchant/feed-data', () => ({
  getGoogleMerchantFeedData: mocks.getFeedData,
}));
vi.mock('./catalog-version', () => ({
  readCrossRemCatalogVersion: async () => 'synthetic-version',
}));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));
vi.mock('@/lib/tenant-rate-limit', () => ({
  checkTenantRateLimitDetailed: async () => ({ verdict: 'allowed' }),
}));
vi.mock('./catalog-bindings', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('./catalog-bindings')),
  crossRemCatalogConfig: {
    bindings: mocks.bindings,
    merchantId: 'ogabassey-id',
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv(
    'CROSSREM_CATALOG_TOKEN',
    'synthetic-crossrem-access-token-qa-test-0001'
  );
  mocks.bindings.splice(0, mocks.bindings.length, {
    listingId: 'legacy-id',
    productId: 'item',
    condition: 'used',
  });
  mocks.resolveMerchant.mockResolvedValue({
    id: 'ogabassey-id',
    slug: 'ogabassey',
    country: 'NG',
    business_name: 'Ogabassey',
    gmc_variants_enabled: false,
  });
  mocks.getFeedData.mockResolvedValue({
    slug: 'ogabassey',
    custom_domain: 'ogabassey.com',
    products: [],
    imageManifest: {},
  });
});

afterEach(() => vi.unstubAllEnvs());

describe('CrossRem catalog source', () => {
  it('keeps the bound SKU when the Google family now prefers a different SKU', async () => {
    mocks.bindings[0] = {
      ...mocks.bindings[0],
      listingId: 'item',
      variantId: 'used-sku',
    };
    mocks.getFeedData.mockResolvedValue({
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      products: [
        {
          id: 'item',
          name: 'Item',
          slug: 'item',
          description: 'Test listing',
          variant_model: 'sku_matrix',
          price: 300,
          stock: 1,
          manage_stock: true,
          variants: [
            {
              id: 'new-sku',
              condition: 'new',
              price_override: 250,
              stock_quantity: 1,
            },
            {
              id: 'used-sku',
              condition: 'used',
              price_override: 200,
              stock_quantity: 0,
            },
          ],
        },
      ],
      imageManifest: {
        item: [
          {
            verified_url: 'https://cdn.example.com/item.jpg',
            status: 'verified',
            verified_format: 'jpeg',
            is_primary: true,
            position: 0,
            variant_id: 'used-sku',
          },
          {
            verified_url: 'https://cdn.example.com/new-item.jpg',
            status: 'verified',
            verified_format: 'jpeg',
            is_primary: true,
            position: 0,
            variant_id: 'new-sku',
          },
        ],
      },
    });
    const response = await GET(
      new Request('https://example.test/api/partners/v1/catalog', {
        headers: {
          Authorization: 'Bearer synthetic-crossrem-access-token-qa-test-0001',
        },
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      schema_version: 1,
      currency: 'NGN',
      listings: [
        {
          listing_id: 'item',
          variant_id: 'used-sku',
          base_price_minor: 20000,
          availability: 'out_of_stock',
        },
      ],
    });
    expect(mocks.resolveMerchant).toHaveBeenCalledWith('ogabassey-id', false);
    expect(mocks.getFeedData).toHaveBeenCalledWith('ogabassey-id', 'ogabassey');
  });

  it('refuses an incomplete snapshot so CrossRem retains the prior catalog', async () => {
    await expect(loadCrossRemCatalog()).rejects.toThrow(
      'Incomplete CrossRem catalog'
    );
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        missingCount: 1,
        sampleListingIds: ['legacy-id'],
      })
    );
  });

  it('publishes an empty snapshot when every configured listing was retired', async () => {
    mocks.bindings[0].retired = true;

    await expect(loadCrossRemCatalog()).resolves.toEqual({
      schema_version: 1,
      currency: 'NGN',
      listings: [],
    });
    expect(mocks.getFeedData).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('fails before reading a catalog if the merchant identity differs', async () => {
    mocks.resolveMerchant.mockResolvedValue({
      id: 'other',
      slug: 'ogabassey',
      country: 'NG',
    });
    await expect(loadCrossRemCatalog()).rejects.toThrow(
      'CrossRem merchant unavailable'
    );
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'CrossRem merchant unavailable',
        resolvedMerchantId: 'other',
      })
    );
    expect(mocks.getFeedData).not.toHaveBeenCalled();
  });

  it('logs the failed source stage without logging the underlying error', async () => {
    const error = new Error('private source details');
    mocks.resolveMerchant.mockRejectedValueOnce(error);
    await expect(loadCrossRemCatalog()).rejects.toBe(error);
    expect(mocks.warn).toHaveBeenNthCalledWith(1, {
      message: 'CrossRem merchant lookup failed',
      merchantId: 'ogabassey-id',
    });

    mocks.getFeedData.mockRejectedValueOnce(error);
    await expect(loadCrossRemCatalog()).rejects.toBe(error);
    expect(mocks.warn).toHaveBeenNthCalledWith(2, {
      message: 'CrossRem catalog source read failed',
      merchantId: 'ogabassey-id',
    });
  });

  it('fails before reading when the bindings have yet to be supplied', async () => {
    mocks.bindings.length = 0;
    await expect(loadCrossRemCatalog()).rejects.toThrow(
      'CrossRem catalog is unconfigured'
    );
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'CrossRem catalog is unconfigured',
        activeCount: 0,
      })
    );
    expect(mocks.resolveMerchant).not.toHaveBeenCalled();
  });
});
