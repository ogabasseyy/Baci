import type { TransactionDiscountLineAllocation } from '@baci/shared/contracts';
import { getPersistedLineKeyCandidates } from './transaction-review-persisted-line-key-candidates';
import { toPositiveInteger } from './transaction-review-positive-integer';

export interface DiscountableTransactionItem {
  condition?: string | null;
  line_id?: number | string | null;
  product_id?: string | null;
  quiz_award_id?: string | null;
  quiz_award_amount?: number | string | null;
  variant_id?: string | null;
  variant_attributes?: Record<string, string> | null;
  price: number | string | null;
  quantity: number | string | null;
  assurance_fee?: number | string | null;
  vat_category_code?: string | null;
  vat_rate?: number | string | null;
}

export type ValidatedExplicitLineDiscounts =
  | {
      allocationsByLineId: Map<number, TransactionDiscountLineAllocation>;
      mode: 'lineId';
    }
  | {
      allocationsByIdentity: Map<string, TransactionDiscountLineAllocation>;
      mode: 'identity';
    }
  | {
      allocationsByLineKey: Map<string, TransactionDiscountLineAllocation>;
      allocationsByIdentity: Map<string, TransactionDiscountLineAllocation>;
      mode: 'lineKey';
    };

export function resolveTransactionDiscountAllocation(
  allocations: ValidatedExplicitLineDiscounts,
  item: DiscountableTransactionItem,
  occurrenceOrdinal?: number
): TransactionDiscountLineAllocation | undefined {
  const identity =
    typeof item.product_id === 'string' &&
    (item.variant_id === null || typeof item.variant_id === 'string')
      ? JSON.stringify([item.product_id, item.variant_id ?? null])
      : null;

  if (allocations.mode === 'lineKey') {
    for (const lineKey of getPersistedLineKeyCandidates(
      item,
      occurrenceOrdinal
    )) {
      const keyedAllocation = allocations.allocationsByLineKey.get(lineKey);
      if (keyedAllocation) {
        return keyedAllocation;
      }
    }
    return identity == null
      ? undefined
      : allocations.allocationsByIdentity.get(identity);
  }

  if (allocations.mode === 'identity') {
    return identity == null
      ? undefined
      : allocations.allocationsByIdentity.get(identity);
  }

  const lineId = toPositiveInteger(item.line_id);
  return lineId == null
    ? undefined
    : allocations.allocationsByLineId.get(lineId);
}
