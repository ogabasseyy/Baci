import type { CachedProductLcpHint } from '@/lib/cached-data';

export function parseRouteProductNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function getLcpRouteLegacyPrices(
  cachedProduct: Pick<CachedProductLcpHint, 'price' | 'compare_at_price'>
) {
  const price = parseRouteProductNumber(cachedProduct.price);
  const compareAtPrice = parseRouteProductNumber(
    cachedProduct.compare_at_price
  );
  const hasSale =
    price !== null && compareAtPrice !== null && compareAtPrice > price;

  return {
    basePrice: hasSale ? compareAtPrice : (price ?? compareAtPrice),
    compareAtPrice,
    price: price ?? compareAtPrice,
    salePrice: hasSale ? price : null,
  };
}
