import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedMerchant, CachedProductLcpHint } from '@/lib/cached-data';
import type { LcpRouteProduct } from './category-product-lcp-projection';
import {
  type CategoryProductRouteControl,
  getProductRouteControl,
} from './category-product-route-control';

const {
  evaluateCanonicalRoute,
  getCachedProductLcpHint,
  getRequestScopedMerchant,
  mapCachedHint,
  resolveFullProduct,
} = vi.hoisted(() => ({
  evaluateCanonicalRoute: vi.fn(),
  getCachedProductLcpHint: vi.fn(),
  getRequestScopedMerchant: vi.fn(),
  mapCachedHint: vi.fn(),
  resolveFullProduct: vi.fn(),
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedProductLcpHint,
  getRequestScopedMerchant,
  sanitizeLookupLogValue: (value: unknown) => String(value ?? '').slice(0, 100),
}));

vi.mock('./category-product-canonicalization', () => ({
  evaluateCategoryProductCanonicalRoute: evaluateCanonicalRoute,
}));

vi.mock('./category-product-detail-resolution', () => ({
  resolveCategoryProductForMerchant: resolveFullProduct,
}));

vi.mock('./category-product-lcp-projection', () => ({
  mapCachedProductLcpHintToRouteProduct: mapCachedHint,
}));

const merchant = { id: 'merchant-1' } as CachedMerchant;
const compactHint = { id: 'product-1' } as CachedProductLcpHint;
const mappedProduct = {
  id: 'product-1',
  slug: 'canonical-product',
  category_slug: 'canonical-category',
} as LcpRouteProduct;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getProductRouteControl', () => {
  it('returns null when the storefront merchant cannot be resolved', async () => {
    getRequestScopedMerchant.mockResolvedValue(null);

    await expect(
      getProductRouteControl(
        'unknown-merchant-store',
        'category',
        'unknown-product'
      )
    ).resolves.toBeNull();

    expect(getRequestScopedMerchant).toHaveBeenCalledWith(
      'unknown-merchant-store'
    );
    expect(getCachedProductLcpHint).not.toHaveBeenCalled();
    expect(resolveFullProduct).not.toHaveBeenCalled();
  });

  it('rejects unsafe product slugs before merchant or cached-product lookups', async () => {
    await expect(
      getProductRouteControl('store', 'category', 'x'.repeat(4000))
    ).resolves.toBeNull();

    expect(getRequestScopedMerchant).not.toHaveBeenCalled();
    expect(getCachedProductLcpHint).not.toHaveBeenCalled();
    expect(resolveFullProduct).not.toHaveBeenCalled();
  });

  it('uses the compact hint for canonical routing and defers full detail resolution', async () => {
    getRequestScopedMerchant.mockResolvedValue(merchant);
    getCachedProductLcpHint.mockResolvedValue(compactHint);
    mapCachedHint.mockReturnValue(mappedProduct);
    evaluateCanonicalRoute.mockReturnValue({
      categoryMismatch: true,
      needsValuesRedirect: false,
    });
    const detailedResult = { detail: 'authoritative product result' };
    resolveFullProduct.mockResolvedValue(detailedResult);

    const routeControl = await getProductRouteControl(
      'store',
      'requested-category',
      'Requested-Product'
    );

    expect(routeControl?.result).toEqual({
      product: mappedProduct,
      merchant,
      categoryMismatch: true,
      needsValuesRedirect: false,
    });
    expect(getCachedProductLcpHint).toHaveBeenCalledWith(
      'merchant-1',
      'Requested-Product',
      { includeVariants: true }
    );
    expect(evaluateCanonicalRoute).toHaveBeenCalledWith({
      requestedCategorySlug: 'requested-category',
      requestedProductSlug: 'Requested-Product',
      resolvedCategorySlug: 'canonical-category',
      resolvedProductSlug: 'canonical-product',
    });
    expect(resolveFullProduct).not.toHaveBeenCalled();

    await expect(
      (routeControl as CategoryProductRouteControl).loadProductResult()
    ).resolves.toBe(detailedResult);
    expect(resolveFullProduct).toHaveBeenCalledWith(
      merchant,
      'requested-category',
      'Requested-Product'
    );
  });

  it('returns the detail resolver legacy redirect result when no compact hint exists', async () => {
    getRequestScopedMerchant.mockResolvedValue(merchant);
    getCachedProductLcpHint.mockResolvedValue(null);
    const legacyResult = {
      merchant,
      legacyRedirectTarget: { slug: 'canonical-product' },
    };
    resolveFullProduct.mockResolvedValue(legacyResult);

    const routeControl = await getProductRouteControl(
      'store',
      'category',
      'legacy-variant-slug'
    );

    expect(routeControl?.result).toBe(legacyResult);
    await expect(
      (routeControl as CategoryProductRouteControl).loadProductResult()
    ).resolves.toBe(legacyResult);
    expect(resolveFullProduct).toHaveBeenCalledTimes(1);
    expect(mapCachedHint).not.toHaveBeenCalled();
  });

  it('returns null when neither the compact hint nor detail resolver finds a product', async () => {
    getRequestScopedMerchant.mockResolvedValue(merchant);
    getCachedProductLcpHint.mockResolvedValue(null);
    resolveFullProduct.mockResolvedValue(null);

    await expect(
      getProductRouteControl(
        'missing-product-store',
        'category',
        'missing-product'
      )
    ).resolves.toBeNull();

    expect(getCachedProductLcpHint).toHaveBeenCalledWith(
      'merchant-1',
      'missing-product',
      { includeVariants: true }
    );
    expect(resolveFullProduct).toHaveBeenCalledWith(
      merchant,
      'category',
      'missing-product'
    );
    expect(mapCachedHint).not.toHaveBeenCalled();
  });
});
