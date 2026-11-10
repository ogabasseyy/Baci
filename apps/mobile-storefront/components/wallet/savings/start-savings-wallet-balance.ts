import type { WalletData } from '@/hooks/wallet-query';

/**
 * The balance a new plan's head start can come from. A PiggyVest customer
 * spends their PiggyVest main wallet (reported in kobo), never the legacy
 * wallet figure, which stays at zero for them. `primaryWallet` tells the
 * submit flow to move the head start through PiggyVest after the plan exists,
 * because the plan-creation call can only debit the legacy wallet.
 */
export function resolveStartSavingsWalletBalance(
  wallet: WalletData | undefined
): { balance: number; primaryWallet: boolean } {
  const kobo = wallet?.primary_balance_kobo;
  if (typeof kobo === 'number' && Number.isFinite(kobo) && kobo >= 0)
    return { balance: kobo / 100, primaryWallet: true };
  return { balance: wallet?.balance ?? 0, primaryWallet: false };
}
