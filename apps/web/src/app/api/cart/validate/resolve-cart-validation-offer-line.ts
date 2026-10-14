import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { getEffectiveStock, type StockLike } from '@/lib/product-stock';

export function getCartValidationKey(
  id: string,
  variantId?: string,
  offerId?: string
) {
  const variantKey = variantId ? `${id}::${variantId}` : id;
  return offerId ? `${variantKey}::offer=${offerId}` : variantKey;
}

export type OfferParentFlags = {
  has_condition_offers: boolean | null;
  has_variants: boolean | null;
  variant_model: string | null;
};

/**
 * Mirrors the order RPC's offer parent gate (M28): the flag must be on,
 * the parent must be non-variant (sku_matrix counts as variant-bearing),
 * and no live non-anchor variants may exist. The variants RPC already
 * excludes inventory anchors, so any row for the product fails the gate.
 * Without this, background validation would retain and reprice a stale
 * offer line that order creation then rejects at checkout.
 */
export function isOfferParentEligible(
  product: OfferParentFlags,
  productHasLiveVariants: boolean
): boolean {
  if (product.has_condition_offers !== true) return false;
  if (
    product.has_variants === true ||
    (product.variant_model ?? '') === 'sku_matrix'
  )
    return false;
  if (productHasLiveVariants) return false;
  return true;
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
      const key = `${String(item.id)}::${item.offerId}`;
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
  return totals.get(`${productId}::${offerId}`);
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
  offer?: { condition: string | null; stock_quantity?: number | string | null };
  parentEligible: boolean;
};

/**
 * Resolves the offer-line checks for one cart validation item: a missing
 * live row (the RPC returns active rows only), a stale row on a
 * variant-bearing or flag-disabled parent, a condition the merchant
 * changed after the line landed in the cart, an aggregate offer
 * quantity above the live offer allocation, or a contradictory
 * variant+offer combo.
 * Returns the invalid-line key, or null when the line passes every
 * offer check (non-offer lines always pass).
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
  parentEligible,
  aggregateOfferQuantity,
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
  // and reprice the line only to fail at checkout.
  if (!variantId && offerId && offer && !parentEligible) {
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
