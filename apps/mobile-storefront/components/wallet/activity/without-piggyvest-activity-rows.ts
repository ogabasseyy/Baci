/**
 * Legacy `customer_wallet_transactions` rows that mirror a movement the
 * PiggyVest wallet activity already lists (contributions, goal refunds and
 * completions). Hidden from the older store credit list so one movement
 * never shows twice.
 */
const PIGGYVEST_ACTIVITY_SOURCE_TYPES = new Set([
  'piggyvest_primary_savings',
  'piggyvest_goal_cancel',
  'piggyvest_goal_complete',
]);

export function withoutPiggyvestActivityRows<
  T extends { source_type?: string | null },
>(transactions: T[]): T[] {
  return transactions.filter(
    (row) => !PIGGYVEST_ACTIVITY_SOURCE_TYPES.has(row.source_type ?? '')
  );
}
