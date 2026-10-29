import {
  resolveVariantDisplaySelection,
  resolveVariantSelection,
} from '@baci/shared/lib/product-default-variant';
import type { Product } from '@/lib/products';
import { pickInitialSelectedAttributes } from './critical-commerce-selection';

export function completeCriticalVariantSelection(
  product: Pick<Product, 'price' | 'condition' | 'manage_stock' | 'variants'>,
  attributes: Record<string, string>,
  renderableVariantAxes: string[],
  variantAxisOptions: Record<string, string[]>
) {
  const options = {
    attributes: Object.fromEntries(
      Object.entries(attributes).filter(([axis]) => axis !== 'condition')
    ),
    condition: attributes.condition,
  };
  const selection = resolveVariantSelection(product, options) ??
    resolveVariantDisplaySelection(product, options);
  return selection
    ? pickInitialSelectedAttributes({
        explicitAttributes: attributes,
        fallbackAxisOptions: variantAxisOptions,
        renderableVariantAxes,
        selection,
      })
    : attributes;
}

