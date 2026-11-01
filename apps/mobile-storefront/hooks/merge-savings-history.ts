import type { Transaction } from './wallet-query';

export function mergeSavingsHistory(
  transactions: Transaction[],
  interest: Transaction[] | undefined
): Transaction[] {
  if (!interest) return transactions;
  const unique = new Map<string, Transaction>();
  for (const entry of [
    ...transactions.filter((item) => item.source_type !== 'savings_interest'),
    ...interest,
  ]) {
    unique.set(entry.id, entry);
  }
  // Funding confirmation also consumes these rows. Limit only the rendered
  // history, so interest entries cannot evict an otherwise fetched top-up.
  return [...unique.values()].sort((first, second) => {
    if (first.created_at === null || second.created_at === null) {
      if (first.created_at !== second.created_at) {
        return first.created_at === null ? 1 : -1;
      }
      return first.id.localeCompare(second.id);
    }
    return (
      Date.parse(second.created_at) - Date.parse(first.created_at) ||
      first.id.localeCompare(second.id)
    );
  });
}
