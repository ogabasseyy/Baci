import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { isPublicVariantPurchasable } from './is-public-variant-purchasable';
import { getEffectiveStock } from './product-stock';

type Parent = {
  price?: number | null;
  compare_at_price?: number | null;
  condition?: string | null;
  manage_stock?: boolean | null;
  stock?: number | null;
  stock_quantity?: number | null;
};
type Variant = {
  price_override?: number | null;
  compare_at_price?: number | null;
  condition?: string | null;
  inventory_tracking_policy?: string | null;
  stock_quantity?: number | null;
};
type Offer = { price?: number | null; stock_quantity?: number | null };

function price(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/** Resolve a selected public option after attributes/condition have been selected.
 * A paired variant owns price, comparison price and inventory; an offer owns
 * the selected condition. Callers supply hydrated public serialized quantities.
 * This helper does not guess eligibility from product descriptions.
 */
export function resolvePublicProductOption(
  parent: Parent,
  selection: {
    variant?: Variant;
    offer?: Offer;
    condition?: string;
    resolvedVariantPrice?: number;
  } = {}
) {
  const { variant, offer } = selection;
  const displayPrice = variant
    ? (price(selection.resolvedVariantPrice) ??
      price(variant.price_override) ??
      price(parent.price))
    : (price(offer?.price) ?? price(parent.price));
  const stockQuantity = variant
    ? variant.inventory_tracking_policy === 'serialized_strict'
      ? (variant.stock_quantity ?? 0)
      : (variant.stock_quantity ?? getEffectiveStock(parent))
    : offer
      ? getEffectiveStock(offer)
      : getEffectiveStock(parent);
  const purchasable = variant
    ? isPublicVariantPurchasable(parent, variant)
    : parent.manage_stock === false ||
      parent.manage_stock === undefined ||
      stockQuantity > 0;
  return {
    price: displayPrice,
    compareAtPrice:
      price(variant?.compare_at_price) ??
      price(parent.compare_at_price) ??
      null,
    condition:
      normalizeCanonicalProductCondition(
        selection.condition ?? variant?.condition ?? parent.condition
      ) || 'new',
    stockQuantity,
    purchasable,
  };
}
