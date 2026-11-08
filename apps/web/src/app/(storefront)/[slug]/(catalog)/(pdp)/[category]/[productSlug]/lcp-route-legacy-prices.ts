import type { CachedProductLcpHint } from '@/lib/cached-data';
import { parseRouteProductNumber } from './parse-route-product-number';

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
