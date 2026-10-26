import { WALLET_HISTORY_PAGE_SIZE } from '@/constants/wallet-history';
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
  return [...unique.values()]
    .sort(
      (first, second) =>
        Date.parse(second.created_at) - Date.parse(first.created_at) ||
        first.id.localeCompare(second.id)
    )
    .slice(0, WALLET_HISTORY_PAGE_SIZE);
}
