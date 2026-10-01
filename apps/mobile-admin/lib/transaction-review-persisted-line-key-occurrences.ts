import type { PersistedLineKeyItem } from './transaction-review-discount-line-key';
import { getPersistedLineKey } from './transaction-review-discount-line-key';
import { toPositiveInteger } from './transaction-review-positive-integer';

export function getPersistedLineKeyOccurrenceOrdinals(
  items: PersistedLineKeyItem[]
): Map<number, number> | undefined {
  const lineKeyCounts = new Map<string, number>();
  const itemIndexesByLineKey = new Map<
    string,
    Array<{ index: number; lineId: number }>
  >();
  const lineKeysWithInvalidLineIds = new Set<string>();

  for (const [index, item] of items.entries()) {
    const lineKey = getPersistedLineKey(item);
    if (lineKey == null) {
      return undefined;
    }
    lineKeyCounts.set(lineKey, (lineKeyCounts.get(lineKey) ?? 0) + 1);

    const lineId = toPositiveInteger(item.line_id);
    if (lineId == null) {
      lineKeysWithInvalidLineIds.add(lineKey);
      continue;
    }

    const entries = itemIndexesByLineKey.get(lineKey) ?? [];
    entries.push({ index, lineId });
    itemIndexesByLineKey.set(lineKey, entries);
  }

  const occurrenceOrdinals = new Map<number, number>();
  for (const [lineKey, itemCount] of lineKeyCounts) {
    if (itemCount < 2) {
      continue;
    }
    const entries = itemIndexesByLineKey.get(lineKey) ?? [];
    if (
      lineKeysWithInvalidLineIds.has(lineKey) ||
      entries.length !== itemCount
    ) {
      return undefined;
    }

    const sortedEntries = [...entries].sort(
      (left, right) => left.lineId - right.lineId
    );
    for (const [entryIndex, entry] of sortedEntries.entries()) {
      if (
        entryIndex > 0 &&
        entry.lineId === sortedEntries[entryIndex - 1]?.lineId
      ) {
        return undefined;
      }
      occurrenceOrdinals.set(entry.index, entryIndex + 1);
    }
  }

  return occurrenceOrdinals;
}
