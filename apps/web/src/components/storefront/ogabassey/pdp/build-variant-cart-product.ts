import type { Product as CartProduct, ProductVariant } from '@/lib/products';
import { resolveVariantInventory } from '@/lib/resolve-variant-inventory';
import type { CriticalCartProductInput } from './critical-cart-product';
import type { ResolvedCriticalVariantSelection } from './critical-commerce-selection';

function nonEmptyStringProp(source: object, key: string): string | undefined {
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function hasFullCartVariants(
  product: CriticalCartProductInput
): product is CartProduct {
  for (const variant of product.variants ?? []) {
    if (
      !('merchant_id' in variant && typeof variant.merchant_id === 'string') ||
      !('product_id' in variant && typeof variant.product_id === 'string')
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Projects the active variant into a `CartProduct`. When `selection` is
 * resolved, `variants` are omitted because `AddToCartOptions.variantId` and
 * line-projected price/stock/image satisfy cart state; when `selection` is
 * null, `variants` are preserved (backfilling only missing ids) so
 * default-variant cart fallback remains intact.
 */
export function buildVariantCartProduct(
  cartProduct: CriticalCartProductInput,
  selection: ResolvedCriticalVariantSelection | null
): CartProduct {
  if (!selection) {
    if (hasFullCartVariants(cartProduct)) return cartProduct;
    const { variants: rawVariants, ...productWithoutVariants } = cartProduct;
    const variants: ProductVariant[] = [];
    for (const variant of rawVariants ?? []) {
      variants.push({
        ...variant,
        merchant_id: nonEmptyStringProp(variant, 'merchant_id') ?? '',
        product_id: nonEmptyStringProp(variant, 'product_id') ?? cartProduct.id,
      });
    }
    return { ...productWithoutVariants, variants };
  }

  const { variants: _variants, ...productWithoutVariants } = cartProduct;
  const variantImage =
    selection.variant.primary_image || selection.variant.images?.[0];
  const inventory = resolveVariantInventory(cartProduct, selection.variant);

  return {
    ...productWithoutVariants,
    compare_at_price: selection.compareAtPrice ?? cartProduct.compare_at_price,
    condition:
      (selection.condition as CartProduct['condition'] | undefined) ??
      cartProduct.condition,
    image: variantImage ?? cartProduct.image,
    imageLarge: variantImage ?? cartProduct.imageLarge,
    manage_stock: inventory.manageStock,
    price: selection.price,
    stock: inventory.stock,
  };
}
