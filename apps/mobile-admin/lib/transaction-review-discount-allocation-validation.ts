import type { TransactionDiscountLineAllocation } from '@baci/shared/contracts';
import type {
  DiscountableTransactionItem,
  ValidatedExplicitLineDiscounts,
} from './transaction-review-discount-allocations';
import {
  DISCOUNT_TOLERANCE,
  getProductVariantIdentity,
} from './transaction-review-discount-helpers';
import { getValidatedLineKeyDiscounts } from './transaction-review-discount-line-key-allocations';
import { toPositiveInteger } from './transaction-review-positive-integer';
import { toFiniteNumberOrNull } from './transaction-review-row-helpers';

interface DiscountLineTotal {
  merchandiseTotal: number;
  quantity: number;
  total: number;
}

type ValidatedLineIdDiscounts = Extract<
  ValidatedExplicitLineDiscounts,
  { mode: 'lineId' }
>;

export function getValidatedExplicitLineDiscounts(
  items: DiscountableTransactionItem[],
  lineTotals: DiscountLineTotal[],
  normalizedDiscount: number,
  explicitLineDiscounts: Array<TransactionDiscountLineAllocation | null>,
  occurrenceOrdinals?: Map<number, number>
): ValidatedExplicitLineDiscounts | undefined {
  const usesPersistedLineKey = explicitLineDiscounts.some(
    (allocation) =>
      typeof allocation?.lineKey === 'string' && allocation.lineKey.length > 0
  );
  const hasDeletedCatalogIdentity =
    items.some((item) => item.product_id === null) ||
    explicitLineDiscounts.some((allocation) => {
      if (allocation == null || typeof allocation.variantId !== 'string') {
        return false;
      }
      const lineId = toPositiveInteger(allocation.lineId);
      const item = items.find(
        (candidate) => toPositiveInteger(candidate.line_id) === lineId
      );
      return (
        item?.variant_id === null && allocation.variantId.trim().length > 0
      );
    });

  if (usesPersistedLineKey && !hasDeletedCatalogIdentity) {
    return getValidatedLineKeyDiscounts(
      items,
      lineTotals,
      normalizedDiscount,
      explicitLineDiscounts,
      occurrenceOrdinals
    );
  }

  const usesPersistedIdentity = explicitLineDiscounts.some(
    (allocation) => allocation?.productId !== undefined
  );

  if (usesPersistedIdentity && !hasDeletedCatalogIdentity) {
    const itemIndexesByIdentity = new Map<string, number>();
    for (const [itemIndex, item] of items.entries()) {
      const identity = getProductVariantIdentity(
        item.product_id,
        item.variant_id
      );
      if (identity == null) {
        return undefined;
      }
      if (itemIndexesByIdentity.has(identity)) {
        // Ambiguous duplicate identities cannot safely receive a negotiated
        // line allocation; proportional fallback is safer than guessing.
        return undefined;
      }
      itemIndexesByIdentity.set(identity, itemIndex);
    }

    const allocationsByIdentity = new Map<
      string,
      TransactionDiscountLineAllocation
    >();
    let allocationTotal = 0;
    for (const allocation of explicitLineDiscounts) {
      if (allocation == null) {
        continue;
      }
      const identity = getProductVariantIdentity(
        allocation.productId,
        allocation.variantId
      );
      if (identity == null) {
        return undefined;
      }
      const itemIndex = itemIndexesByIdentity.get(identity);
      const line = itemIndex == null ? undefined : lineTotals[itemIndex];
      const lineId = toPositiveInteger(allocation.lineId);
      const merchandiseDiscount = toFiniteNumberOrNull(
        allocation.merchandiseDiscount
      );
      const vatRelief = toFiniteNumberOrNull(allocation.vatRelief);
      if (
        itemIndex == null ||
        !line ||
        lineId == null ||
        allocationsByIdentity.has(identity) ||
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
      allocationsByIdentity.set(identity, {
        ...allocation,
        lineId,
        merchandiseDiscount,
        productId: allocation.productId,
        vatRelief,
        variantId: allocation.variantId ?? null,
      });
    }

    if (
      allocationsByIdentity.size === 0 ||
      Math.abs(allocationTotal - normalizedDiscount) > DISCOUNT_TOLERANCE
    ) {
      return undefined;
    }

    return { allocationsByIdentity, mode: 'identity' };
  }

  return getValidatedLineIdDiscounts(
    items,
    lineTotals,
    normalizedDiscount,
    explicitLineDiscounts
  );
}

function getValidatedLineIdDiscounts(
  items: DiscountableTransactionItem[],
  lineTotals: DiscountLineTotal[],
  normalizedDiscount: number,
  explicitLineDiscounts: Array<TransactionDiscountLineAllocation | null>
): ValidatedLineIdDiscounts | undefined {
  const itemLineIds = new Set<number>();
  for (const item of items) {
    const lineId = toPositiveInteger(item.line_id);
    if (lineId == null || itemLineIds.has(lineId)) {
      return undefined;
    }
    itemLineIds.add(lineId);
  }

  const allocationsByLineId = new Map<
    number,
    TransactionDiscountLineAllocation
  >();
  let allocationTotal = 0;

  for (const allocation of explicitLineDiscounts) {
    if (allocation == null) {
      continue;
    }

    const lineId = toPositiveInteger(allocation.lineId);
    const merchandiseDiscount = toFiniteNumberOrNull(
      allocation.merchandiseDiscount
    );
    const vatRelief = toFiniteNumberOrNull(allocation.vatRelief);
    if (
      lineId == null ||
      allocationsByLineId.has(lineId) ||
      !itemLineIds.has(lineId) ||
      merchandiseDiscount == null ||
      merchandiseDiscount < 0 ||
      vatRelief == null ||
      vatRelief < 0
    ) {
      return undefined;
    }

    const itemIndex = items.findIndex(
      (item) => toPositiveInteger(item.line_id) === lineId
    );
    const line = itemIndex >= 0 ? lineTotals[itemIndex] : undefined;
    if (
      !line ||
      merchandiseDiscount > line.merchandiseTotal + DISCOUNT_TOLERANCE ||
      vatRelief > line.total + DISCOUNT_TOLERANCE ||
      merchandiseDiscount + vatRelief > line.total + DISCOUNT_TOLERANCE
    ) {
      return undefined;
    }

    allocationTotal += merchandiseDiscount + vatRelief;
    allocationsByLineId.set(lineId, {
      lineId,
      merchandiseDiscount,
      vatRelief,
    });
  }

  if (
    allocationsByLineId.size === 0 ||
    Math.abs(allocationTotal - normalizedDiscount) > DISCOUNT_TOLERANCE
  ) {
    return undefined;
  }

  return { allocationsByLineId, mode: 'lineId' };
}
