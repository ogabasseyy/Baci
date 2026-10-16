import type { CartItem } from '@/stores/cart-store';
import {
  getDriftedOfferCondition,
  hasLinePriceDrift,
  type LiveOfferRepriceMap,
  resolveOfferLinePrice,
} from './cart-reprice-offer-lines';
import type { RepriceResult } from './cart-reprice-types';

export type OfferLineAllocation = {
  id: string;
  name: string;
  offerId: string;
  quantity: number;
};

/**
 * Reprices one exact-offer line from its live offer row and records the
 * line's allocation for post-loop stock reconciliation. A failed lookup
 * skips the line, but a vanished offer after a successful lookup is
 * unavailable (the orders route would reject it).
 */
export function repriceExactOfferLine({
  effectiveItem,
  item,
  offerEligibleParents,
  offerLineAllocations,
  offerPrice,
  result,
}: {
  effectiveItem: Omit<CartItem, 'offer_id'> & { offer_id: string };
  item: CartItem;
  offerEligibleParents: Set<string>;
  offerLineAllocations: OfferLineAllocation[];
  offerPrice: LiveOfferRepriceMap;
  result: RepriceResult;
}): void {
  const live = resolveOfferLinePrice(effectiveItem, offerPrice);
  if (!live || !offerEligibleParents.has(item.product_id)) {
    result.unavailable.push({ id: item.id, name: item.name });
    return;
  }
  result.priceById[item.id] = live.price;
  offerLineAllocations.push({
    id: item.id,
    name: item.name,
    offerId: effectiveItem.offer_id,
    quantity: effectiveItem.quantity,
  });
  // A merchant-edited condition refreshes with the price so the line
  // matches what checkout will accept.
  const driftedCondition = getDriftedOfferCondition(
    item.condition,
    live.condition
  );
  if (driftedCondition) {
    result.conditionById[item.id] = driftedCondition;
  }
  // Line basis (not unit): checkout rejects an extended-total
  // drift past tolerance, so a sub-tolerance unit move on
  // quantity > 1 must still surface and refresh.
  if (hasLinePriceDrift(live.price, item.price, item.quantity)) {
    result.changes.push({
      id: item.id,
      name: item.name,
      oldPrice: item.price,
      newPrice: live.price,
    });
  }
  // A condition-only refresh still reconciles (conditionById
  // above) but must not masquerade as a price move: identical
  // old/new prices would render "X to X" and abort checkout
  // with a misleading "prices changed" message.
  if (driftedCondition && item.condition) {
    result.conditionChanges.push({
      id: item.id,
      name: item.name,
      oldCondition: item.condition,
      newCondition: driftedCondition,
    });
  }
}

/**
 * Flags exact-offer lines whose offer cannot cover the cart's aggregate
 * take. A merchant edit or concurrent order can deplete an offer below
 * the aggregate after the price lookup: without this, the line reports
 * available and dies at order creation with insufficient_offer_stock.
 * Aggregates per offer like the RPC does; every contributing line is
 * flagged since checkout rejects the whole order, not a single line.
 */
export function reconcileOfferLineAllocations({
  offerLineAllocations,
  offerPrice,
  result,
}: {
  offerLineAllocations: OfferLineAllocation[];
  offerPrice: LiveOfferRepriceMap;
  result: RepriceResult;
}): void {
  const aggregateByOfferId = new Map<string, number>();
  for (const allocation of offerLineAllocations) {
    aggregateByOfferId.set(
      allocation.offerId,
      (aggregateByOfferId.get(allocation.offerId) ?? 0) + allocation.quantity
    );
  }
  for (const allocation of offerLineAllocations) {
    const liveStock = offerPrice.get(allocation.offerId)?.stockQuantity;
    const aggregate = aggregateByOfferId.get(allocation.offerId) ?? 0;
    if (
      liveStock != null &&
      Number.isFinite(liveStock) &&
      aggregate > liveStock
    ) {
      result.unavailable.push({ id: allocation.id, name: allocation.name });
    }
  }
}
