import {
  buildTransactionDiscountLineKey,
  buildTransactionDiscountLineOccurrenceKey,
} from '@baci/shared/contracts';
import type { EligibleLineDiscountResult } from './eligible-line-discount';

/** Line identity input for persisted occurrence keys (structural subset). */
export type NegotiationOccurrenceItem = {
  condition?: string | null;
  product_id?: string;
  variant_attributes?: Record<string, string> | null;
  variant_id?: string | null;
};

export type IndexedNegotiationOccurrenceItem = {
  item: NegotiationOccurrenceItem;
  lineId: number;
};

/**
 * Stamps persisted per-line occurrence keys onto a discount result so
 * duplicate lines of one product keep distinct redemption keys.
 */
export function applyPersistedLineOccurrenceKeys(
  result: EligibleLineDiscountResult,
  indexedItems: IndexedNegotiationOccurrenceItem[],
  productMap: Map<string, { condition: string | null }>
): EligibleLineDiscountResult {
  if (!result.lineDiscounts) {
    return result;
  }

  const lineKeys = indexedItems.map(({ item }) => {
    if (!item.product_id) {
      return null;
    }
    const product = productMap.get(item.product_id);
    return buildTransactionDiscountLineKey({
      condition: item.condition?.trim() || product?.condition,
      productId: item.product_id,
      variantAttributes: item.variant_attributes ?? null,
      variantId: item.variant_id ?? null,
    });
  });
  const lineIdentityCounts = new Map<string, number>();
  for (const { item } of indexedItems) {
    if (!item.product_id) {
      continue;
    }
    const identity = JSON.stringify([item.product_id, item.variant_id ?? null]);
    lineIdentityCounts.set(
      identity,
      (lineIdentityCounts.get(identity) ?? 0) + 1
    );
  }
  const lineKeyCounts = new Map<string, number>();
  const occurrenceByLineId = new Map<number, number>();
  for (const lineKey of lineKeys) {
    if (lineKey == null) {
      continue;
    }
    lineKeyCounts.set(lineKey, (lineKeyCounts.get(lineKey) ?? 0) + 1);
  }
  const seenLineKeys = new Map<string, number>();
  for (const [index, lineKey] of lineKeys.entries()) {
    if (lineKey == null) {
      continue;
    }
    const occurrence = (seenLineKeys.get(lineKey) ?? 0) + 1;
    seenLineKeys.set(lineKey, occurrence);
    occurrenceByLineId.set(
      indexedItems[index]?.lineId ?? index + 1,
      occurrence
    );
  }

  return {
    ...result,
    lineDiscounts: result.lineDiscounts.map((allocation) => {
      if (!allocation) {
        return allocation;
      }
      const itemIndex = allocation.lineId - 1;
      const lineKey = lineKeys[itemIndex];
      const item = indexedItems[itemIndex]?.item;
      const identity = item?.product_id
        ? JSON.stringify([item.product_id, item.variant_id ?? null])
        : null;
      if (
        lineKey == null ||
        identity == null ||
        (lineIdentityCounts.get(identity) ?? 0) < 2
      ) {
        return allocation;
      }
      const occurrence = occurrenceByLineId.get(allocation.lineId);
      if (occurrence == null) {
        return allocation;
      }
      return {
        ...allocation,
        lineKey:
          (lineKeyCounts.get(lineKey) ?? 0) === 1
            ? lineKey
            : buildTransactionDiscountLineOccurrenceKey(lineKey, occurrence),
      };
    }),
  };
}
