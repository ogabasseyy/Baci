import {
  type CanonicalProductCondition,
  normalizeCanonicalProductCondition,
} from '@baci/shared/lib';
import { getEffectiveStock } from '@/lib/product-stock';
import type { Product, ProductVariant } from '@/lib/products';

// Placeholder image for products without images
export const PLACEHOLDER_IMAGE = '/placeholder.svg';

const VALID_CONDITIONS = new Set<CanonicalProductCondition>([
  'new',
  'used',
  'open_box',
]);

export type ProductCondition = CanonicalProductCondition;

export function getValidConditionOptions(values: string[]) {
  return values
    .map((value) => normalizeCanonicalProductCondition(value))
    .filter(
      (value): value is ProductCondition =>
        value !== '' && VALID_CONDITIONS.has(value)
    );
}

export function areSelectionAttributesEqual(
  left: Record<string, string>,
  right: Record<string, string>
) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([key, value]) => right[key] === value);
}

/**
 * Extract unique attribute types and their values from variants
 */
export function getAttributeOptions(
  variants: ProductVariant[]
): { key: string; values: string[] }[] {
  const attributeMap = new Map<string, Set<string>>();

  for (const variant of variants) {
    for (const [key, value] of Object.entries(variant.attributes)) {
      if (!attributeMap.has(key)) {
        attributeMap.set(key, new Set());
      }
      attributeMap.get(key)?.add(value);
    }
  }

  return Array.from(attributeMap.entries()).map(([key, values]) => ({
    key,
    values: Array.from(values).sort(),
  }));
}

export const conditionLabels: Record<string, string> = {
  new: 'New',
  used: 'Premium Used',
  open_box: 'Open Box',
};
export const conditionDescriptions: Record<string, string> = {
  new: 'Factory sealed with full manufacturer warranty',
  open_box: 'Opened but unused, all accessories included',
  used: 'Fully tested and inspected, 30-day warranty',
};

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
                stock: selectedOffer.stock_quantity ?? 0,
                stock_quantity: selectedOffer.stock_quantity ?? 0,
              }
            : product
      )
    : Number.POSITIVE_INFINITY;
  const isOutOfStock = isStockManaged ? currentStock === 0 : false;
  return { currentPrice, currentCompareAtPrice, currentStock, isOutOfStock };
}
