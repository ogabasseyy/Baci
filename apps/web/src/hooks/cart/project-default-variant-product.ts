import type { ResolvedProductVariantSelection } from '@baci/shared/lib/product-default-variant';
import type { Product, ProductVariant } from '@/lib/products';
import { resolveVariantInventory } from '@/lib/resolve-variant-inventory';

export function projectDefaultVariantProduct(
  product: Product,
  selection: ResolvedProductVariantSelection<ProductVariant>
): Product {
  const inventory = resolveVariantInventory(product, selection.variant);

  return {
    ...product,
    price: selection.price,
    compare_at_price: selection.compareAtPrice ?? product.compare_at_price,
    manage_stock: inventory.manageStock,
    stock: inventory.stock,
  };
}
