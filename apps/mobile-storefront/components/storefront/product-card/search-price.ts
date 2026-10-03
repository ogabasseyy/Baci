import type { Product } from '@/types/product';
import { formatPrice } from '@/types/product';
export function formatSearchCardPrice(
  product: Pick<Product, 'price' | 'searchMatch'>
): string {
  if (product.searchMatch)
    return product.searchMatch.price === undefined
      ? 'Price unavailable'
      : formatPrice(product.searchMatch.price);
  return formatPrice(product.price);
}
