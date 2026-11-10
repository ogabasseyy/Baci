import type { WalletData } from '@/hooks/wallet-query';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';

export const PRIMARY_HEAD_START_SHORT_MESSAGE =
  'Your wallet balance is less than this head start. Add money to your wallet or lower the head start.';
export const PRIMARY_HEAD_START_ABOVE_TARGET_MESSAGE =
  'Your head start cannot be more than the plan target.';
export const PRIMARY_BALANCE_CHECK_FAILED_MESSAGE =
  "We couldn't check your wallet balance just now. Please try again.";
/** Same budget as the wallet load: never hang the form on a slow read. */
export const FRESH_PRIMARY_BALANCE_TIMEOUT_MS = 5000;

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
 * A fresh PiggyVest main-wallet balance (whole kobo) for the head-start check
 * right before a plan is created. The wallet screen's figure may be a
 * stand-in up to two minutes old, so it never decides whether money can
 * move. `merchantId` is the screen's resolved merchant (with the configured
 * fallback). Null when the balance cannot be confirmed within the budget.
 */
export async function readFreshPrimaryBalanceKobo(
  merchantId: string | null | undefined
): Promise<number | null> {
  const userId = useAuthStore.getState().user?.id;
  if (!merchantId || !userId) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), FRESH_PRIMARY_BALANCE_TIMEOUT_MS);
    });
    const snapshot = await Promise.race([
      piggyvestPrimaryWalletApi.read(merchantId, userId),
      timeout,
    ]);
    if (!snapshot) return null;
    const { account, balanceKobo } = snapshot;
    if (
      !account ||
      typeof balanceKobo !== 'number' ||
      !Number.isSafeInteger(balanceKobo) ||
      balanceKobo < 0
    )
      return null;
    return balanceKobo;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
