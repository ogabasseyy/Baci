import {
  normalizeCanonicalProductCondition,
  resolveOfferAllocatableStock,
} from '@baci/shared/lib';
import { isPublicVariantPurchasable } from './is-public-variant-purchasable';
import { getEffectiveStock } from './product-stock';
import {
  isUnmanagedVariantStock,
  resolveSerializedVariantStock,
} from './serialized-variant-stock';

type Parent = {
  price?: number | null;
  compare_at_price?: number | null;
  condition?: string | null;
  manage_stock?: boolean | null;
  stock?: number | null;
  stock_quantity?: number | null;
  inventory_tracking_policy?: string | null;
  effective_policy?: string | null;
  available_units?: number | null;
};
type Variant = {
  price_override?: number | null;
  compare_at_price?: number | null;
  condition?: string | null;
  inventory_tracking_policy?: string | null;
  effective_policy?: string | null;
  available_units?: number | null;
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
  // Offer stock resolves through the shared authority (the finite
  // scalar binds; a missing scalar inherits the parent stock): exactly
  // what checkout enforces.
  // Strict base units come from the live projection when hydrated,
  // else the folded snapshot stock (units fold into stock_quantity):
  // exactly the pool the serialized helper used to read.
  const parentStock = getEffectiveStock(parent);
  const offerStock = offer
    ? resolveOfferAllocatableStock(offer.stock_quantity, {
        effective_policy: parent.effective_policy,
        inventory_tracking_policy: parent.inventory_tracking_policy,
        availableUnits: parent.available_units ?? parentStock,
        parentStock,
      })
    : undefined;
  // An unbounded offer allocation (serialized_then_unlimited with no
  // scalar) stays purchasable with no finite count — the PDP pricing
  // path maps it to Infinity, never to the parent stock.
  const stockQuantity = variant
    ? isUnmanagedVariantStock(variant)
      ? Number.POSITIVE_INFINITY
      : (resolveSerializedVariantStock(variant) ??
        variant.stock_quantity ??
        getEffectiveStock(parent))
    : offerStock === null
      ? Number.POSITIVE_INFINITY
      : (offerStock ?? getEffectiveStock(parent));
  // A selected offer's finite allocation binds even on unmanaged
  // parents (checkout enforces the scalar there too): only an
  // unbounded (null) allocation or no offer at all reaches the
  // unmanaged short-circuit below.
  const purchasable = variant
    ? isPublicVariantPurchasable(parent, variant)
    : typeof offerStock === 'number'
      ? offerStock > 0
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
