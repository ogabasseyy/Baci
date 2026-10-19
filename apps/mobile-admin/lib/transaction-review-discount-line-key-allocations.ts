import type { TransactionDiscountLineAllocation } from '@baci/shared/contracts';
import type {
  DiscountableTransactionItem,
  ValidatedExplicitLineDiscounts,
} from './transaction-review-discount-allocations';
import {
  DISCOUNT_TOLERANCE,
  getProductVariantIdentity,
} from './transaction-review-discount-helpers';
import { getPersistedLineKeyCandidates } from './transaction-review-persisted-line-key-candidates';
import { toPositiveInteger } from './transaction-review-positive-integer';
import { toFiniteNumberOrNull } from './transaction-review-row-helpers';

interface DiscountLineTotal {
  merchandiseTotal: number;
  quantity: number;
  total: number;
}

type ValidatedLineKeyDiscounts = Extract<
  ValidatedExplicitLineDiscounts,
  { mode: 'lineKey' }
>;

export function getValidatedLineKeyDiscounts(
  items: DiscountableTransactionItem[],
  lineTotals: DiscountLineTotal[],
  normalizedDiscount: number,
  explicitLineDiscounts: Array<TransactionDiscountLineAllocation | null>,
  occurrenceOrdinals?: Map<number, number>
): ValidatedLineKeyDiscounts | undefined {
  if (occurrenceOrdinals == null) {
    return undefined;
  }

  const itemIndexesByLineKey = new Map<string, number[]>();
  const itemIndexesByIdentity = new Map<string, number[]>();
  for (const [itemIndex, item] of items.entries()) {
    const identity = getProductVariantIdentity(
      item.product_id,
      item.variant_id
    );
    if (identity == null) {
      return undefined;
    }
    const identityIndexes = itemIndexesByIdentity.get(identity) ?? [];
    identityIndexes.push(itemIndex);
    itemIndexesByIdentity.set(identity, identityIndexes);

    for (const lineKey of getPersistedLineKeyCandidates(
      item,
      occurrenceOrdinals.get(itemIndex)
    )) {
      const lineKeyIndexes = itemIndexesByLineKey.get(lineKey) ?? [];
      lineKeyIndexes.push(itemIndex);
      itemIndexesByLineKey.set(lineKey, lineKeyIndexes);
    }
  }

  // Reserve keyed targets before resolving identity-only allocations. This
  // allows a duplicate product/variant identity to safely carry one keyed
  // allocation and one unkeyed allocation, while keeping two unkeyed lines
  // ambiguous and therefore rejected.
  const keyedItemIndexes = new Map<string, number>();
  const claimedItemIndexes = new Set<number>();
  for (const allocation of explicitLineDiscounts) {
    const lineKey =
      typeof allocation?.lineKey === 'string' && allocation.lineKey.length > 0
        ? allocation.lineKey
        : null;
    if (lineKey == null) {
      continue;
    }
    const lineKeyIndexes = itemIndexesByLineKey.get(lineKey);
    if (lineKeyIndexes?.length !== 1) {
      return undefined;
    }
    if (keyedItemIndexes.has(lineKey)) {
      return undefined;
    }
    const itemIndex = lineKeyIndexes[0];
    keyedItemIndexes.set(lineKey, itemIndex);
    claimedItemIndexes.add(itemIndex);
  }

  const allocationsByLineKey = new Map<
    string,
    TransactionDiscountLineAllocation
  >();
  const allocationsByIdentity = new Map<
    string,
    TransactionDiscountLineAllocation
  >();
  let allocationTotal = 0;
  for (const allocation of explicitLineDiscounts) {
    if (allocation == null) {
      continue;
    }
    const lineKey =
      typeof allocation.lineKey === 'string' && allocation.lineKey.length > 0
        ? allocation.lineKey
        : null;
    const identity = getProductVariantIdentity(
      allocation.productId,
      allocation.variantId
    );
    const itemIndex =
      lineKey != null
        ? keyedItemIndexes.get(lineKey)
        : identity == null
          ? undefined
          : (itemIndexesByIdentity
              .get(identity)
              ?.filter((candidate) => !claimedItemIndexes.has(candidate))
              .at(0) ?? undefined);
    if (lineKey == null && identity != null) {
      const availableIdentityIndexes =
        itemIndexesByIdentity
          .get(identity)
          ?.filter((candidate) => !claimedItemIndexes.has(candidate)) ?? [];
      if (availableIdentityIndexes.length !== 1) {
        return undefined;
      }
      claimedItemIndexes.add(availableIdentityIndexes[0]);
    }
    const line = itemIndex == null ? undefined : lineTotals[itemIndex];
    const lineId = toPositiveInteger(allocation.lineId);
    const merchandiseDiscount = toFiniteNumberOrNull(
      allocation.merchandiseDiscount
    );
    const vatRelief = toFiniteNumberOrNull(allocation.vatRelief);
    if (
      identity == null ||
      !line ||
      lineId == null ||
      merchandiseDiscount == null ||
      merchandiseDiscount < 0 ||
      vatRelief == null ||
      vatRelief < 0 ||
      merchandiseDiscount > line.merchandiseTotal + DISCOUNT_TOLERANCE ||
      vatRelief > line.total + DISCOUNT_TOLERANCE ||
      merchandiseDiscount + vatRelief > line.total + DISCOUNT_TOLERANCE
    ) {
      return undefined;
    }
    allocationTotal += merchandiseDiscount + vatRelief;
    const normalizedAllocation = {
      ...allocation,
      lineId,
      merchandiseDiscount,
      vatRelief,
      ...(lineKey ? { lineKey } : {}),
    };
    if (lineKey != null) {
      if (allocationsByLineKey.has(lineKey)) {
        return undefined;
      }
      allocationsByLineKey.set(lineKey, normalizedAllocation);
    } else if (identity != null) {
      if (allocationsByIdentity.has(identity)) {
        return undefined;
      }
      allocationsByIdentity.set(identity, normalizedAllocation);
    }
  }

  if (
    allocationsByLineKey.size + allocationsByIdentity.size === 0 ||
    Math.abs(allocationTotal - normalizedDiscount) > DISCOUNT_TOLERANCE
  ) {
    return undefined;
  }

  return { allocationsByIdentity, allocationsByLineKey, mode: 'lineKey' };
}
