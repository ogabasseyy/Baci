import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCachedLegacyProductRedirectTarget = vi.fn();
const mockGetCachedProductWithDetails = vi.fn();
const mockGetRequestScopedMerchant = vi.fn();

vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
  permanentRedirect: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedLegacyProductRedirectTarget: (...args: unknown[]) =>
    mockGetCachedLegacyProductRedirectTarget(...args),
  getCachedProductWithDetails: (...args: unknown[]) =>
    mockGetCachedProductWithDetails(...args),
  getRequestScopedMerchant: (...args: unknown[]) =>
    mockGetRequestScopedMerchant(...args),
  sanitizeLookupLogValue: (value: unknown) => String(value ?? '').slice(0, 100),
}));

import {
  getCategorizedRedirectTarget,
  getProductCached,
} from './product-page-resolution';

const merchant = {
  id: 'merchant-1',
  business_name: 'Test Store',
  slug: 'test-store',
};

const snapshotProduct = {
  id: 'product-1',
  merchant_id: 'merchant-1',
  name: 'Snapshot Phone',
  slug: 'snapshot-phone',
  description: 'One bounded read.',
  status: 'active',
  price: 250000,
  manage_stock: false,
  stock_quantity: 10,
  images: [],
  brand: 'Baci',
  category: 'Smartphones',
  categories: {
    id: 'category-1',
    name: 'Smartphones',
    slug: 'smartphones',
  },
  product_variants: [],
  product_key_specs: null,
};

describe('getProductCached', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestScopedMerchant.mockResolvedValue(merchant);
  });

  it('resolves a PDP from the single bounded core snapshot', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue(snapshotProduct);

    const result = await getProductCached('test-store', 'snapshot-phone');

    expect(mockGetCachedProductWithDetails).toHaveBeenCalledOnce();
    expect(mockGetCachedProductWithDetails).toHaveBeenCalledWith(
      'merchant-1',
      'snapshot-phone'
    );
    expect(result?.product).toEqual(
      expect.objectContaining({
        id: 'product-1',
        brand: 'Baci',
        category_slug: 'smartphones',
        price: 250000,
      })
    );
  });

  it('returns an explicit product miss without issuing a fallback query', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue(null);

    await expect(
      getProductCached('test-store', 'missing-phone')
    ).resolves.toEqual({ merchant, product: null });
    expect(mockGetCachedProductWithDetails).toHaveBeenCalledOnce();
  });

  it('propagates snapshot unavailability instead of converting it to not found', async () => {
    const timeout = { code: '57014', message: 'statement timeout' };
    mockGetCachedProductWithDetails.mockRejectedValue(timeout);

    await expect(getProductCached('test-store', 'snapshot-phone')).rejects.toBe(
      timeout
    );
  });
});

describe('getCategorizedRedirectTarget', () => {
  const categorizedProduct = {
    id: 'product-1',
    name: 'Snapshot Phone',
    slug: 'snapshot-phone',
    category_slug: 'smartphones',
  };

  it('preserves the matched option params through the categorized redirect', () => {
    expect(
      getCategorizedRedirectTarget('test-store', categorizedProduct as never, {
        variantId: 'variant-256',
        condition: 'used',
      })
    ).toBe('/smartphones/snapshot-phone?variantId=variant-256&condition=used');
  });

  it('returns a bare path without params and null for generic products', () => {
    expect(
      getCategorizedRedirectTarget('test-store', categorizedProduct as never)
    ).toBe('/smartphones/snapshot-phone');
    expect(
      getCategorizedRedirectTarget(
        'test-store',
        {
          id: 'product-2',
          name: 'Mystery Item',
          slug: 'mystery-item',
        } as never,
        { condition: 'used' }
      )
    ).toBeNull();
  });
});
