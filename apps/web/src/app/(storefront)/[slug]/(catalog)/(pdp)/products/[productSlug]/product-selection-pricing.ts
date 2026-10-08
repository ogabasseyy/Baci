import { getEffectiveStock } from '@/lib/product-stock';
import type { Product } from '@/lib/products';

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
  const currentStock = isStockManaged
    ? getEffectiveStock(
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
      )
    : Number.POSITIVE_INFINITY;
  const isOutOfStock = isStockManaged ? currentStock === 0 : false;
  return { currentPrice, currentCompareAtPrice, currentStock, isOutOfStock };
}
