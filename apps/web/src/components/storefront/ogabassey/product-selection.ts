import { requiresProductSelection } from '@baci/shared/lib/product-selection-required';
import type { Product } from './types';

export function requiresOgabasseyProductSelection(product: Product) {
  return requiresProductSelection(product);
}
