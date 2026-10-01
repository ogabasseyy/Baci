import { buildTransactionDiscountLineOccurrenceKey } from '@baci/shared/contracts';
import type { PersistedLineKeyItem } from './transaction-review-discount-line-key';
import { getPersistedLineKey } from './transaction-review-discount-line-key';

export function getPersistedLineKeyCandidates(
  item: PersistedLineKeyItem,
  occurrenceOrdinal?: number
): string[] {
  const lineKey = getPersistedLineKey(item);
  if (lineKey == null) {
    return [];
  }

  return occurrenceOrdinal == null
    ? [lineKey]
    : [
        lineKey,
        buildTransactionDiscountLineOccurrenceKey(lineKey, occurrenceOrdinal),
      ];
}
