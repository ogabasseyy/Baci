import { walletGoalMetadata } from './wallet-goal-metadata';
import type { WalletQueryData } from './wallet-query';

export function classifyWalletChange(
  table: string,
  payload:
    | {
        eventType?: string;
        new?: Record<string, unknown>;
        old?: Record<string, unknown>;
      }
    | undefined,
  cached: WalletQueryData | undefined,
  scope: { merchantId: string; customerId?: string }
): 'ignore' | 'full' | 'numbers' | 'history' {
  const row = payload?.eventType === 'DELETE' ? payload.old : payload?.new;
  if (row?.merchant_id && row.merchant_id !== scope.merchantId) return 'ignore';
  if (
    table !== 'customers' &&
    row?.customer_id &&
    scope.customerId &&
    row.customer_id !== scope.customerId
  )
    return 'ignore';
  if (!row || !cached) return 'full';
  if (table === 'customer_wallet_transactions')
    return row.wallet_id === cached.walletId ? 'history' : 'ignore';
  if (table === 'customer_wallets')
    return payload?.eventType === 'UPDATE' && row.id === cached.walletId
      ? 'history'
      : 'full';
  if (table === 'customer_savings_contributions') return 'history';
  if (
    table === 'customer_savings_goals' &&
    payload?.eventType === 'UPDATE' &&
    typeof row.id === 'string'
  ) {
    const metadata = walletGoalMetadata(row);
    return metadata && cached.goalMetadata?.[row.id] === metadata
      ? 'numbers'
      : 'full';
  }
  return 'full';
}
