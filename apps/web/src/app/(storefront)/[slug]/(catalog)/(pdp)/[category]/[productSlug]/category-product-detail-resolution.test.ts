import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedMerchant } from '@/lib/cached-data';
import { getCachedLegacyProductRedirectTarget } from '@/lib/cached-data';
import { resolveCategoryProductForMerchant } from './category-product-detail-resolution';

const cachedDataMocks = vi.hoisted(() => ({
  getCachedLegacyProductRedirectTarget: vi.fn(),
  getCachedProductWithDetails: vi.fn(),
}));

vi.mock('@/lib/cached-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cached-data')>()),
  getCachedLegacyProductRedirectTarget:
    cachedDataMocks.getCachedLegacyProductRedirectTarget,
  getCachedProductWithDetails: cachedDataMocks.getCachedProductWithDetails,
}));

const merchant = {
  id: 'merchant-1',
  slug: 'store',
} as CachedMerchant;

function cachedProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    merchant_id: 'merchant-1',
    name: 'Phone X',
    slug: 'phone-x',
    status: 'active',
    description: 'Phone',
    price: '1200000',
    compare_at_price: '1500000',
    condition: 'new',
    manage_stock: false,
    stock: 0,
    stock_quantity: 0,
    category: 'Phones',
    categories: { id: 'category-1', name: 'Smartphones', slug: 'smartphones' },
    images: [
      'https://cdn.example/primary.avif',
      { url: 'https://cdn.example/gallery.avif', alt: 'Gallery phone' },
    ],
    variant_attributes: { Colour: ['Red', 'Blue'] },
    product_variants: [
      {
        id: 'variant-1',
        product_id: 'product-1',
        attributes: { Colour: 'Red' },
        condition: 'new',
        is_active: true,
        status: 'active',
        stock_quantity: 0,
      },
    ],
    product_offers: [
      {
        id: 'active-used',
        condition: 'used',
        status: 'active',
        price: 900_000,
      },
      {
        id: 'same-condition',
        condition: 'new',
        status: 'active',
        price: 1_200_000,
      },
      {
        id: 'inactive-offer',
        condition: 'open_box',
        status: 'inactive',
        price: 1_000_000,
      },
    ],
    ...overrides,
  };
}

function setProductResult(product: unknown) {
  cachedDataMocks.getCachedProductWithDetails.mockResolvedValue(product);
}

describe('resolveCategoryProductForMerchant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cachedDataMocks.getCachedProductWithDetails.mockResolvedValue(null);
    cachedDataMocks.getCachedLegacyProductRedirectTarget.mockResolvedValue(
      null
    );
  });

  it('resolves the merchant-scoped detail snapshot and normalizes public commerce fields', async () => {
    setProductResult(cachedProduct());

    const result = await resolveCategoryProductForMerchant(
      merchant,
      'phones',
      'phone-x'
    );

    expect(cachedDataMocks.getCachedProductWithDetails).toHaveBeenCalledWith(
      'merchant-1',
      'phone-x'
    );
    expect(getCachedLegacyProductRedirectTarget).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      categoryMismatch: false,
      needsValuesRedirect: false,
      product: {
        category: 'Smartphones',
        category_slug: 'smartphones',
        compare_at_price: 1_500_000,
        has_variant_matrix: true,
        image: 'https://cdn.example/primary.avif',
        images: [
          {
            alt: 'Phone X',
            order: 0,
            url: 'https://cdn.example/primary.avif',
          },
          {
            alt: 'Gallery phone',
            order: 1,
            url: 'https://cdn.example/gallery.avif',
          },
        ],
        manage_stock: false,
        price: 1_200_000,
        stock: 0,
        variant_attributes: { colour: ['Red', 'Blue'] },
        variants: [
          expect.objectContaining({
            attributes: { Colour: 'Red' },
            id: 'variant-1',
            stock_quantity: 0,
          }),
        ],
      },
    });
    if (!result || !('product' in result)) {
      throw new Error('Expected resolved product result');
    }
    expect(result.product.offers?.map((offer) => offer.id)).toEqual([
      'active-used',
    ]);
  });

  it('uses category aliases without redirecting and flags a genuinely different category', async () => {
    setProductResult(cachedProduct());
    const aliasResult = await resolveCategoryProductForMerchant(
      merchant,
      'smartphones',
      'phone-x'
    );
    expect(aliasResult).toMatchObject({ categoryMismatch: false });

    const mismatchResult = await resolveCategoryProductForMerchant(
      merchant,
      'tablets',
      'phone-x'
    );
    expect(mismatchResult).toMatchObject({ categoryMismatch: true });
  });

  it('flags mixed-case canonical slugs but leaves UUID product routes alone', async () => {
    setProductResult(cachedProduct());
    const mixedCase = await resolveCategoryProductForMerchant(
      merchant,
      'phones',
      'Phone-X'
    );
    expect(mixedCase).toMatchObject({ needsValuesRedirect: true });

    const uuidRoute = await resolveCategoryProductForMerchant(
      merchant,
      'phones',
      '11111111-1111-1111-1111-111111111111'
    );
    expect(uuidRoute).toMatchObject({ needsValuesRedirect: false });
  });

  it('uses placeholder imagery and avoids category redirects when category data is absent', async () => {
    setProductResult(
      cachedProduct({
        categories: null,
        category: null,
        images: [],
        product_categories: null,
      })
    );

    const result = await resolveCategoryProductForMerchant(
      merchant,
      'phones',
      'phone-x'
    );
    expect(result).toMatchObject({
      categoryMismatch: false,
      product: {
        category: null,
        category_slug: undefined,
        image: '/placeholder.png',
        images: [],
      },
    });
  });

  it('defaults missing stock tracking to managed and uses legacy price fallback', async () => {
    setProductResult(
      cachedProduct({
        compare_at_price: null,
        manage_stock: null,
        price: '0',
        stock: 4,
        stock_quantity: 4,
      })
    );

    const result = await resolveCategoryProductForMerchant(
      merchant,
      'phones',
      'phone-x'
    );

    expect(result).toMatchObject({
      product: {
        manage_stock: true,
        price: 0,
        stock: 4,
      },
    });
  });

  it('returns a legacy redirect target when the detail lookup misses', async () => {
    const legacyTarget = {
      id: 'legacy-variant',
      name: 'Phone X',
      slug: 'phone-x-used',
      category: 'Phones',
    };
    cachedDataMocks.getCachedLegacyProductRedirectTarget.mockResolvedValue(
      legacyTarget
    );

    await expect(
      resolveCategoryProductForMerchant(merchant, 'phones', 'old-phone-x')
    ).resolves.toEqual({ merchant, legacyRedirectTarget: legacyTarget });
    expect(getCachedLegacyProductRedirectTarget).toHaveBeenCalledWith(
      'merchant-1',
      'old-phone-x'
    );
  });

  it('returns null for a product absent from both current and legacy lookups', async () => {
    await expect(
      resolveCategoryProductForMerchant(merchant, 'phones', 'missing')
    ).resolves.toBeNull();
  });

  it('propagates detail lookup errors without attempting a legacy redirect lookup', async () => {
    const lookupError = new Error('snapshot unavailable');
    cachedDataMocks.getCachedProductWithDetails.mockRejectedValue(lookupError);

    await expect(
      resolveCategoryProductForMerchant(merchant, 'phones', 'phone-x')
    ).rejects.toBe(lookupError);
    expect(getCachedLegacyProductRedirectTarget).not.toHaveBeenCalled();
  });
});
