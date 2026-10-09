import { getEffectiveStock } from '@/lib/product-stock';
import type { Product } from '@/lib/products';
import { resolveSerializedVariantStock } from '@/lib/serialized-variant-stock';

export interface SelectionPricingOffer {
  price: number | string;
  stock_quantity?: number | string | null;
}

export interface SelectionPricingDisplaySelection {
  price: number;
  compareAtPrice?: number | null;
}

export interface SelectionPricingVariant {
  price_override?: number | null;
  stock_quantity?: number | string | null;
  effective_policy?: string | null;
  available_units?: number | null;
}

/**
 * Price and stock for the current offer/variant selection. A matched
 * condition offer wins over any variant pricing; unmanaged stock is
 * unlimited.
 */
export function resolveSelectionPricing({
  product,
  selectedOffer,
  displaySelection,
  effectiveVariant,
  isStockManaged,
}: {
  product: Product;
  selectedOffer: SelectionPricingOffer | null;
  displaySelection: SelectionPricingDisplaySelection | null;
  effectiveVariant: SelectionPricingVariant | null;
  isStockManaged: boolean;
}): {
  currentPrice: number;
  currentCompareAtPrice: number | undefined;
  currentStock: number;
  isOutOfStock: boolean;
} {
  // Get current price based on condition offer or variant selection
  const currentPrice =
    selectedOffer?.price != null
      ? Number(selectedOffer.price)
      : (displaySelection?.price ??
        effectiveVariant?.price_override ??
        product.price);
  const currentCompareAtPrice =
    displaySelection?.compareAtPrice ?? product.compare_at_price;
  // Serialized tracking resolves from exact units (strict) or stays enabled
  // with no finite count (unlimited); only non-serialized selections reach
  // the scalar/parent logic below.
  const serializedVariantStock = effectiveVariant
    ? resolveSerializedVariantStock(effectiveVariant)
    : undefined;
  const currentStock = !isStockManaged
    ? Number.POSITIVE_INFINITY
    : (serializedVariantStock ??
      getEffectiveStock(
        effectiveVariant
          ? {
              stock:
                effectiveVariant.stock_quantity ?? product.stock ?? undefined,
              stock_quantity:
                effectiveVariant.stock_quantity ?? product.stock ?? undefined,
            }
          : selectedOffer
            ? {
                // A null offer quantity inherits parent stock (mirroring
                // the variants branch and the price-options CTE): the
                // offer is purchasable, not out of stock.
                stock:
                  selectedOffer.stock_quantity ?? product.stock ?? undefined,
                stock_quantity:
                  selectedOffer.stock_quantity ?? product.stock ?? undefined,
              }
            : product
      ));
  const isOutOfStock = isStockManaged ? currentStock === 0 : false;
  return { currentPrice, currentCompareAtPrice, currentStock, isOutOfStock };
}
