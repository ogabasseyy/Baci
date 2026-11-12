import { router } from 'expo-router';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { WALLET_TOP_UP_MIN_AMOUNT } from '@/lib/wallet-top-up-constants';

/**
 * PiggyVest customers pay utilities from store credit, which only a card
 * top-up adds (a bank transfer would land in their PiggyVest savings
 * wallet). Opens the wallet's card-only "Add store credit" sheet with the
 * shortfall prefilled (never below the card top-up minimum, which the form
 * would refuse), then returns to the purchase.
 */
export function navigateToStoreCreditTopUp(
  shortfall: number,
  returnToHref: WalletReturnHref
): void {
  const requiredAmount = Math.max(
    WALLET_TOP_UP_MIN_AMOUNT,
    Math.ceil(shortfall)
  );
  router.push(
    `/wallet?action=fund&requiredAmount=${requiredAmount}&returnTo=${encodeURIComponent(returnToHref)}`
  );
}
