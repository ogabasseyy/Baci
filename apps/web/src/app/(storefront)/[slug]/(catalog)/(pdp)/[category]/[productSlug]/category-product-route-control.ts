import { cache } from 'react';
import type {
  CachedLegacyProductRedirectTarget,
  CachedMerchant,
} from '@/lib/cached-data';
import {
  getCachedProductLcpHint,
  getRequestScopedMerchant,
  sanitizeLookupLogValue,
} from '@/lib/cached-data';
import { generateSlug } from '@/lib/seo-utils';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import { evaluateCategoryProductCanonicalRoute } from './category-product-canonicalization';
import {
  type CategoryProductResult,
  resolveCategoryProductForMerchant,
} from './category-product-detail-resolution';
import {
  type LcpRouteProduct,
  mapCachedProductLcpHintToRouteProduct,
} from './category-product-lcp-projection';

type CategoryProductRouteControlResult =
  | {
      product: LcpRouteProduct;
      categoryMismatch: boolean;
      merchant: CachedMerchant;
      needsValuesRedirect: boolean;
    }
  | {
      merchant: CachedMerchant;
      legacyRedirectTarget: CachedLegacyProductRedirectTarget;
    };

export interface CategoryProductRouteControl {
  result: CategoryProductRouteControlResult;
  loadProductResult: () => Promise<CategoryProductResult>;
}

function getMappedProductCategorySlug(product: LcpRouteProduct) {
  return (
    product.category_slug ||
    (product.category ? generateSlug(product.category) : null)
  );
}

/** Shares one compact route lookup across metadata and the page render. */
export const getProductRouteControl = cache(
  async (
    storeSlug: string,
    categorySlug: string,
    productSlug: string
  ): Promise<CategoryProductRouteControl | null> => {
    // Over-long / repeatedly-encoded bot slugs can never match a product; bail
    // before any `'use cache'`/Supabase lookup runs with an unbounded key.
    if (!evaluateStorefrontSlugSafety(productSlug).safe) {
      console.warn(
        'Skipped product route lookups for unsafe product slug:',
        sanitizeLookupLogValue(productSlug)
      );
      return null;
    }

    const merchant = await getRequestScopedMerchant(storeSlug);

    if (!merchant) {
      console.warn(
        'Merchant not found for storefront product route:',
        storeSlug
      );
      return null;
    }

    const cachedProduct = await getCachedProductLcpHint(
      merchant.id,
      productSlug,
      {
        includeVariants: true,
      }
    );
    if (!cachedProduct) {
      const result = await resolveCategoryProductForMerchant(
        merchant,
        categorySlug,
        productSlug
      );
      return result
        ? {
            result,
            loadProductResult: () => Promise.resolve(result),
          }
        : null;
    }

    const product = mapCachedProductLcpHintToRouteProduct(cachedProduct);
    const canonicalRoute = evaluateCategoryProductCanonicalRoute({
      requestedCategorySlug: categorySlug,
      requestedProductSlug: productSlug,
      resolvedCategorySlug: getMappedProductCategorySlug(product),
      resolvedProductSlug: product.slug,
    });
    const loadProductResult = () =>
      resolveCategoryProductForMerchant(merchant, categorySlug, productSlug);

    return {
      result: {
        product,
        merchant,
        ...canonicalRoute,
      },
      loadProductResult,
    };
  }
);
