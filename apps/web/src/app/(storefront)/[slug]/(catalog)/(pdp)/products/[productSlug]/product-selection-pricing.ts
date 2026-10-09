import { getEffectiveStock } from '@/lib/product-stock';
import type { Product } from '@/lib/products';
import { resolveSerializedOfferStock } from '@/lib/serialized-offer-stock';
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
  // Offer selections on serialized simple products cap by the folded base
  // unit count (strict) or the binding offer scalar (unlimited) — ahead
  // of the unmanaged short-circuit, since unlimited folds manage_stock
  // false while the scalar still binds the order.
  const serializedOfferStock =
    !effectiveVariant && selectedOffer
      ? resolveSerializedOfferStock(selectedOffer, product)
      : undefined;
  const managedStock = !isStockManaged
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
  const currentStock = serializedOfferStock ?? managedStock;
  // A zero allocation disables purchase even when the snapshot folds the
  // product unmanaged (unlimited offers still bind their scalar).
  const isOutOfStock = currentStock === 0;
  return { currentPrice, currentCompareAtPrice, currentStock, isOutOfStock };
}
