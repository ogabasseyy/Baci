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
 * Flags lines on serialized_strict products whose shared base pool cannot
 * cover the cart's aggregate take. Offer allocations are per-offer but the
 * strict pool is product-wide: a base line plus an exact-offer line can
 * each fit their own allocation while jointly exceeding the pool, and the
 * order would then die server-side with serialized_inventory_unavailable.
 * Mirrors the PDP's pool gate (offer line must fit its allocation AND the
 * product total must fit the pool). Unknown pools skip the check — the
 * order RPC arbitrates — so a read gap never blocks checkout.
 */
export function reconcileStrictBasePools({
  baseInventoryByProductId,
  items,
  result,
}: {
  baseInventoryByProductId: Record<
    string,
    { effective_policy?: string | null; available_units?: number | null }
  > | null;
  items: CartItem[];
  result: RepriceResult;
}): void {
  if (baseInventoryByProductId === null) {
    return;
  }
  const alreadyFlagged = new Set(result.unavailable.map((line) => line.id));
  const simpleLinesByProductId = new Map<string, CartItem[]>();
  for (const item of items) {
    if (item.variant_id) {
      continue;
    }
    if (item.voucher_token || item.voucher_award_id) {
      continue;
    }
    // Lines already flagged unavailable earlier in repricing (vanished
    // or invalid offers) will be removed before checkout: excluding
    // them from the pool total keeps one bad sibling from marking a
    // valid line unavailable too.
    if (alreadyFlagged.has(item.id)) {
      continue;
    }
    const siblings = simpleLinesByProductId.get(item.product_id) ?? [];
    siblings.push(item);
    simpleLinesByProductId.set(item.product_id, siblings);
  }
  for (const [productId, siblings] of simpleLinesByProductId) {
    const inventory = baseInventoryByProductId[productId];
    if (inventory?.effective_policy !== 'serialized_strict') {
      continue;
    }
    const availableUnits = inventory.available_units;
    if (
      typeof availableUnits !== 'number' ||
      !Number.isFinite(availableUnits)
    ) {
      continue;
    }
    const aggregate = siblings.reduce((sum, line) => sum + line.quantity, 0);
    if (aggregate <= availableUnits) {
      continue;
    }
    for (const line of siblings) {
      if (!alreadyFlagged.has(line.id)) {
        alreadyFlagged.add(line.id);
        result.unavailable.push({ id: line.id, name: line.name });
      }
    }
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
