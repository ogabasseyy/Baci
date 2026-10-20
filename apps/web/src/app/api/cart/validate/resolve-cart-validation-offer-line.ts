import {
  makeOfferLineKey,
  normalizeCanonicalProductCondition,
} from '@baci/shared/lib';
import { getBaseLineValidationKey } from '@/hooks/cart/cart-validation-keys';
import { getEffectiveStock, type StockLike } from '@/lib/product-stock';

export function getCartValidationKey(
  id: string,
  variantId?: string,
  offerId?: string
) {
  const variantKey = variantId ? `${id}::${variantId}` : id;
  return offerId ? `${variantKey}::offer=${offerId}` : variantKey;
}

export type OfferQuantityTotalInput = {
  id: string | number;
  variantId?: string;
  offerId?: string;
  quantity?: number;
};

/**
 * Total validated quantity per product/offer across every cart line.
 * Duplicate lines arise when an offer changes between canonical
 * aliases; the order RPC decrements the shared offer allocation once
 * per aggregated total, so the per-line stock check must compare the
 * same aggregate. Lines with variants, without offers, or without a
 * numeric quantity contribute nothing.
 */
export function buildOfferQuantityTotals(
  items: readonly OfferQuantityTotalInput[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (!item.variantId && item.offerId && typeof item.quantity === 'number') {
      const key = makeOfferLineKey(String(item.id), String(item.offerId));
      totals.set(key, (totals.get(key) ?? 0) + item.quantity);
    }
  }
  return totals;
}

/** Reads one product/offer aggregate built by buildOfferQuantityTotals. */
export function readOfferQuantityTotal(
  totals: ReadonlyMap<string, number>,
  productId: string,
  offerId: string
): number | undefined {
  return totals.get(makeOfferLineKey(productId, offerId));
}

export type SimpleProductQuantityTotalInput = {
  id: string | number;
  variantId?: string;
  offerId?: string;
  quantity?: number;
  isQuizVoucherLine?: boolean;
};

/**
 * Total validated quantity per product across the base line and every
 * sibling offer line. Under strict serialized tracking all of those
 * lines claim the same hidden-anchor pool, so the pool check compares
 * this aggregate — not each line alone. Variant lines never share the
 * pool and pre-reserved voucher lines redeem units outside it, so both
 * contribute nothing.
 */
export function buildSimpleProductQuantityTotals(
  items: readonly SimpleProductQuantityTotalInput[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (
      item.variantId ||
      item.isQuizVoucherLine ||
      typeof item.quantity !== 'number'
    ) {
      continue;
    }
    const key = String(item.id);
    totals.set(key, (totals.get(key) ?? 0) + item.quantity);
  }
  return totals;
}

/** Reads one product aggregate built by buildSimpleProductQuantityTotals. */
export function readSimpleProductQuantityTotal(
  totals: ReadonlyMap<string, number>,
  productId: string
): number | undefined {
  return totals.get(productId);
}

export type OfferLineResolutionInput = {
  strId: string;
  variantId?: string;
  offerId?: string;
  submittedCondition?: string;
  quantity?: number;
  /**
   * Total quantity across every cart line naming this product/offer.
   * Duplicate lines arise naturally when an offer changes between
   * canonical aliases (each spelling is its own cart line while the
   * validator treats them as equivalent); the order RPC decrements the
   * shared allocation once per aggregated total, so the stock check
   * must compare the same aggregate, not each line alone.
   */
  aggregateOfferQuantity?: number;
  offer?: {
    condition: string | null;
    stock_quantity?: number | string | null;
    /** M28 parent gate from the SQL authority (never re-derived here). */
    parent_eligible?: boolean;
  };
  /**
   * Total quantity across this product's base line and every sibling
   * offer line (voucher lines excluded). Compared against
   * strictPoolUnits for serialized_strict products.
   */
  aggregateSimpleQuantity?: number;
  /**
   * Live shared-unit pool from the base-inventory projection, or null
   * when the product is not strict-tracked or the projection read
   * failed (fail-open: the check is skipped, matching past behavior).
   */
  strictPoolUnits?: number | null;
  /** Pre-reserved voucher lines redeem units outside the pool. */
  isQuizVoucherLine?: boolean;
};

/**
 * Resolves the offer-line checks for one cart validation item: a missing
 * live row (the RPC returns active rows only), a stale row on a
 * variant-bearing or flag-disabled parent, a condition the merchant
 * changed after the line landed in the cart, an aggregate offer
 * quantity above the live offer allocation, a simple-line aggregate
 * above the shared strict serialized pool, or a contradictory
 * variant+offer combo.
 * Returns the invalid-line key, or null when the line passes every
 * offer check.
 */
export type ReportedLineStockItem = {
  variantId?: string;
  offerId?: string;
};

export type ReportedLineStockOffer = {
  stock_quantity?: number | string | null;
};

/**
 * Reported stock for one validated line. Non-variant offer lines report
 * the live offer allocation, not the parent: the order RPC decrements
 * product_offers.stock_quantity, so reporting parent stock would show a
 * purchasable offer line as unavailable (or overstate its cap). Rows
 * without a finite scalar fall back to the parent, same as the
 * invalid-line check's skip.
 */
export function resolveReportedLineStock(
  item: ReportedLineStockItem,
  offer: ReportedLineStockOffer | undefined,
  product: StockLike
): number {
  if (!item.variantId && item.offerId) {
    const allocation = Number(offer?.stock_quantity ?? Number.NaN);
    if (Number.isFinite(allocation)) return allocation;
  }
  return getEffectiveStock(product);
}

export function getInvalidOfferLineKey({
  strId,
  variantId,
  offerId,
  submittedCondition,
  quantity,
  offer,
  aggregateOfferQuantity,
  aggregateSimpleQuantity,
  strictPoolUnits,
  isQuizVoucherLine,
}: OfferLineResolutionInput): string | null {
  // Non-variant offer lines price from the live condition offer, not
  // the parent: pricing them from products.price would silently
  // replace the advertised offer price on every validation pass. A
  // missing row means the offer is gone, so only that line is
  // invalidated.
  if (!variantId && offerId && !offer) {
    return getCartValidationKey(strId, undefined, offerId);
  }

  // A live offer row on a variant-bearing (or flag-disabled) parent is
  // stale: order creation rejects it, so validation must not retain
  // and reprice the line only to fail at checkout. The gate lives in
  // SQL; a row without the flag fails closed.
  if (!variantId && offerId && offer && offer.parent_eligible !== true) {
    return getCartValidationKey(strId, undefined, offerId);
  }

  // Staff can change an active offer's condition after it lands in a
  // cart. The orders route canonically compares and rejects a drifted
  // persisted condition, so validation invalidates the line early —
  // mirroring that comparison — instead of reporting it valid and
  // failing only at checkout. Lines without a submitted condition
  // skip the check, same as the orders route.
  if (
    !variantId &&
    offerId &&
    offer &&
    submittedCondition != null &&
    normalizeCanonicalProductCondition(submittedCondition) !==
      normalizeCanonicalProductCondition(offer.condition ?? '')
  ) {
    return getCartValidationKey(strId, undefined, offerId);
  }

  // Another order (or a merchant edit) can deplete the live offer
  // allocation below the quantity already sitting in this cart while the
  // offer row itself stays active. Order creation rejects that line
  // with insufficient_offer_stock, so validation must invalidate it
  // early instead of reporting the line valid. Lines without a
  // submitted quantity and rows without a finite scalar skip the
  // check — there is nothing to compare.
  if (!variantId && offerId && offer) {
    const scalar = Number(offer.stock_quantity ?? Number.NaN);
    // Compare the aggregate across duplicate lines (see input docs):
    // the RPC decrements the shared allocation once per total.
    const comparedQuantity =
      typeof aggregateOfferQuantity === 'number'
        ? aggregateOfferQuantity
        : quantity;
    if (
      typeof comparedQuantity === 'number' &&
      Number.isFinite(scalar) &&
      comparedQuantity > scalar
    ) {
      return getCartValidationKey(strId, undefined, offerId);
    }
  }

  // Sibling simple lines share one strict serialized pool: the base
  // line plus every offer line draw from the same hidden-anchor
  // units, and order creation claims that pool. When their combined
  // cart quantity exceeds the live projection, each simple line is
  // invalid — the shopper re-adds within the cap. Variant lines never
  // share the pool and voucher lines redeem pre-reserved units
  // outside it, so both skip the check.
  if (
    !variantId &&
    !isQuizVoucherLine &&
    typeof aggregateSimpleQuantity === 'number' &&
    typeof strictPoolUnits === 'number' &&
    aggregateSimpleQuantity > strictPoolUnits
  ) {
    // Base lines need their own key shape: a bare product id means
    // product-wide removal, which would also delete the voucher
    // sibling this check explicitly exempted from the pool.
    if (!offerId) {
      return getBaseLineValidationKey(strId);
    }
    return getCartValidationKey(strId, undefined, offerId);
  }

  // A line naming both a variant and a condition offer is contradictory:
  // offers exist only for non-variant products, so neither platform
  // attaches both and there is no defined price basis. Reject the line
  // so cart and checkout agree — the orders route verifies any carried
  // offer_id and would reject a dead one there instead.
  if (variantId && offerId) {
    return getCartValidationKey(strId, variantId, offerId);
  }

  return null;
}
