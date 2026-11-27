import type { StorefrontProductsQuery } from '@/schemas/storefront-products-query.types';

const STOREFRONT_PRODUCTS_CACHE_TAG_PREFIX = 'storefront-products';
const MERCHANT_ID_CACHE_TAG_PREFIX = 'merchant-id';

function normalizeMerchantIdForCacheTag(merchantId: string) {
  if (typeof merchantId !== 'string') {
    throw new TypeError(
      'merchantId must be a string for storefront product cache tags'
    );
  }

  const normalizedMerchantId = merchantId.trim();

  if (!normalizedMerchantId) {
    throw new TypeError(
      'merchantId cannot be empty for storefront product cache tags'
    );
  }

  return normalizedMerchantId;
}

export function getStorefrontProductsCacheTag(merchantId: string) {
  const normalizedMerchantId = normalizeMerchantIdForCacheTag(merchantId);
  return `${STOREFRONT_PRODUCTS_CACHE_TAG_PREFIX}-${normalizedMerchantId}`;
}

export function buildStorefrontProductsCacheTags(merchantId: string) {
  const normalizedMerchantId = normalizeMerchantIdForCacheTag(merchantId);

  return [
    getStorefrontProductsCacheTag(normalizedMerchantId),
    `${MERCHANT_ID_CACHE_TAG_PREFIX}-${normalizedMerchantId}`,
  ];
}

export function buildStorefrontProductsCacheKeyParts(
  merchantId: string,
  filters: StorefrontProductsQuery
) {
  const normalizedMerchantId = normalizeMerchantIdForCacheTag(merchantId);
  const cacheKeyParts = [
    STOREFRONT_PRODUCTS_CACHE_TAG_PREFIX,
    normalizedMerchantId,
  ];

  if (filters.category) cacheKeyParts.push(`cat-${filters.category}`);
  if (filters.brand) {
    const normalizedBrand = filters.brand.trim().toLowerCase();
    if (normalizedBrand) {
      cacheKeyParts.push(`brand-${normalizedBrand}`);
    }
  }
  if (filters.condition) cacheKeyParts.push(`cond-${filters.condition}`);
  if (filters.min_price !== undefined) {
    cacheKeyParts.push(`min-${filters.min_price}`);
  }
  if (filters.max_price !== undefined) {
    cacheKeyParts.push(`max-${filters.max_price}`);
  }
  if (filters.limit !== undefined) {
    cacheKeyParts.push(`limit-${filters.limit}`);
  }
  if (filters.compact) {
    cacheKeyParts.push('compact');
  }
  if (filters.sort) cacheKeyParts.push(`sort-${filters.sort}`);
  if (filters.has_images) {
    cacheKeyParts.push('img-true');
  }
  if (filters.q) {
    const normalizedQuery = filters.q.trim().toLowerCase().slice(0, 100);
    if (normalizedQuery) {
      cacheKeyParts.push(`q-${normalizedQuery}`);
    }
  }

  return cacheKeyParts;
}
