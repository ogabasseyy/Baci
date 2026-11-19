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
  // Deposits are ledger-only since 20261103025419 (a trigger rejects new
  // legacy rows), but a deposit from before that cutover still has its
  // legacy row, and the activity list shows the same deposit from the receipt.
  'piggyvest_primary_inflow',
  'piggyvest_primary_card_custody',
]);

export function withoutPiggyvestActivityRows<
  T extends { source_type?: string | null },
>(transactions: T[]): T[] {
  return transactions.filter(
    (row) => !PIGGYVEST_ACTIVITY_SOURCE_TYPES.has(row.source_type ?? '')
  );
}
