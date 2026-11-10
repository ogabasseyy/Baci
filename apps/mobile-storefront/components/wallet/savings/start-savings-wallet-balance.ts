import type { WalletData } from '@/hooks/wallet-query';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';

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
  // Same gate as the producer (primaryBalanceField): whole kobo, >= 0.
  if (typeof kobo === 'number' && Number.isSafeInteger(kobo) && kobo >= 0)
    return { balance: kobo / 100, primaryWallet: true };
  return { balance: wallet?.balance ?? 0, primaryWallet: false };
}

/**
 * A fresh PiggyVest main-wallet balance (naira) for the head-start check
 * right before a plan is created. The wallet screen's figure may be a
 * stand-in up to two minutes old, so it never decides whether money can
 * move. Null when the balance cannot be confirmed now.
 */
export async function readFreshPrimaryBalance(): Promise<number | null> {
  const { merchantId, user } = useAuthStore.getState();
  if (!merchantId || !user?.id) return null;
  try {
    const { account, balanceKobo } = await piggyvestPrimaryWalletApi.read(
      merchantId,
      user.id
    );
    if (
      !account ||
      typeof balanceKobo !== 'number' ||
      !Number.isSafeInteger(balanceKobo) ||
      balanceKobo < 0
    )
      return null;
    return balanceKobo / 100;
  } catch {
    return null;
  }
}
