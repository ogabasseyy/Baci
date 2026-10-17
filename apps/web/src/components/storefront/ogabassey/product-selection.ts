import { requiresProductSelection } from '../../../../../../packages/shared/src/lib/product-selection-required';
import type { Product } from './types';

export function requiresOgabasseyProductSelection(product: Product) {
  return requiresProductSelection(product);
}
