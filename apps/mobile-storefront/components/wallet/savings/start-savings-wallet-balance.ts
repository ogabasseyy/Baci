import type { WalletData } from '@/hooks/wallet-query';
import { koboToNaira } from '../derive-wallet-display-data';

/**
 * Balance the start-savings flow spends from: the PiggyVest main wallet when
 * the server reported it ready, otherwise the legacy wallet balance exactly
 * as before.
 */
export function deriveStartSavingsWalletBalance(
  wallet: Pick<WalletData, 'balance' | 'primary_balance_kobo'> | undefined
): number {
  if (typeof wallet?.primary_balance_kobo === 'number') {
    return koboToNaira(wallet.primary_balance_kobo);
  }
  return wallet?.balance ?? 0;
}
