import {
  resolveOfferAllocatableStock,
  resolveOfferPriceBasis,
} from '@baci/shared/lib';
import { getEffectiveStock } from '@/lib/product-stock';
import type { Product } from '@/lib/products';
import {
  isUnmanagedVariantStock,
  resolveSerializedVariantStock,
} from '@/lib/serialized-variant-stock';

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
  inventory_tracking_policy?: string | null;
  available_units?: number | null;
}

/**
 * Price and stock for the current offer/variant selection. A matched
 * condition offer wins over any variant pricing; unmanaged stock is
 * unlimited. Offer economics resolve through the shared authority
 * (live price basis, allocatable stock) so the PDP advertises exactly
 * what checkout enforces.
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
  const fallbackPrice =
    displaySelection?.price ??
    effectiveVariant?.price_override ??
    product.price;
  const currentPrice = selectedOffer
    ? resolveOfferPriceBasis(selectedOffer.price, fallbackPrice)
    : fallbackPrice;
  const currentCompareAtPrice =
    displaySelection?.compareAtPrice ?? product.compare_at_price;
  // Serialized tracking resolves from exact units (strict) or stays enabled
  // with no finite count (unlimited); only non-serialized selections reach
  // the scalar/parent logic below.
  const serializedVariantStock = effectiveVariant
    ? resolveSerializedVariantStock(effectiveVariant)
    : undefined;
  const variantIsUnmanaged =
    effectiveVariant != null && isUnmanagedVariantStock(effectiveVariant);
  // Offer selections resolve their allocatable stock through the
  // authority — ahead of the unmanaged short-circuit, since order
  // creation checks the offer allocation even on unmanaged parents, so
  // an unmanaged infinite here would advertise what checkout refuses.
  // The serialized variant count likewise wins over the shortcut: a
  // strict variant with zero units is unorderable on any parent.
  // Snapshot folds carry strict base units in stock_quantity, which
  // the effective-stock reconciliation reads first: pass it as the
  // pool so strict offers cap exactly like the serialized helper did.
  const parentStock = getEffectiveStock(product);
  const offerStock =
    !effectiveVariant && selectedOffer
      ? resolveOfferAllocatableStock(selectedOffer.stock_quantity, {
          // Anchor-derived policy wins (a product-level `off` with a
          // serialized_strict anchor still caps by the strict pool):
          // same precedence as the sibling snapshot callers.
          effective_policy: product.effective_policy ?? null,
          inventory_tracking_policy: product.inventory_tracking_policy ?? null,
          availableUnits: parentStock,
          parentStock,
        })
      : undefined;
  const managedStock =
    !isStockManaged && !selectedOffer && serializedVariantStock === undefined
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
            : product
        ));
  // An unbounded offer allocation (unlimited policy) stays purchasable
  // with no finite count, like unmanaged stock.
  const currentStock = variantIsUnmanaged
    ? Number.POSITIVE_INFINITY
    : offerStock === undefined
      ? managedStock
      : (offerStock ?? Number.POSITIVE_INFINITY);
  // A zero allocation disables purchase even when the snapshot folds the
  // product unmanaged (unlimited offers still bind their scalar).
  const isOutOfStock = !variantIsUnmanaged && currentStock === 0;
  return { currentPrice, currentCompareAtPrice, currentStock, isOutOfStock };
}
