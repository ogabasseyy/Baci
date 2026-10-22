import type { ResolvedProductVariantSelection } from '@baci/shared/lib/product-default-variant';
import { isUnmanagedVariantStock } from '@/lib/is-unmanaged-variant-stock';
import type { Product, ProductVariant } from '@/lib/products';
import { resolveSerializedVariantStock } from '@/lib/serialized-variant-stock';

export function projectDefaultVariantProduct(
  product: Product,
  selection: ResolvedProductVariantSelection<ProductVariant>
): Product {
  const unmanaged = isUnmanagedVariantStock(
    selection.variant,
    product.manage_stock
  );

  return {
    ...product,
    price: selection.price,
    compare_at_price: selection.compareAtPrice ?? product.compare_at_price,
    manage_stock: unmanaged ? false : product.manage_stock,
    stock: unmanaged
      ? product.stock
      : (resolveSerializedVariantStock(selection.variant) ??
        selection.variant.stock_quantity ??
        product.stock),
  };
}
