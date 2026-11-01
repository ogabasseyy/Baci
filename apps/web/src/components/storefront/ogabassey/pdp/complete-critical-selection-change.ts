import type { Product } from '@/lib/products';
import { pruneSelectionsByVariantAvailability } from '@/components/storefront/ogabassey/variant-selection-pruning';
import { recoverHiddenSelectionsFromUniqueVariant } from '@/components/storefront/ogabassey/recover-hidden-variant-selections';
import { completeCriticalVariantSelection } from './complete-critical-variant-selection';

export function completeCriticalSelectionChange(
  product: Pick<Product, 'price' | 'condition' | 'manage_stock' | 'variants'>,
  attributes: Record<string, string>,
  changedAxis: string,
  hiddenAxes: string[],
  visibleAxes: string[],
  axisOptions: Record<string, string[]>
) {
  const pruned = recoverHiddenSelectionsFromUniqueVariant(
    pruneSelectionsByVariantAvailability(attributes, changedAxis, product.variants),
    hiddenAxes,
    product.variants
  );
  return recoverHiddenSelectionsFromUniqueVariant(
    completeCriticalVariantSelection(product, pruned, visibleAxes, axisOptions),
    hiddenAxes,
    product.variants
  );
}
