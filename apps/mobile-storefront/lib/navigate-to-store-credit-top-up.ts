import { router } from 'expo-router';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';

/**
 * PiggyVest customers pay utilities from store credit, which only a card
 * top-up adds (a bank transfer would land in their PiggyVest savings
 * wallet). Opens the wallet's card-only "Add store credit" sheet with the
 * shortfall prefilled, then returns to the purchase.
 */
export function navigateToStoreCreditTopUp(
  shortfall: number,
  returnToHref: WalletReturnHref
): void {
  const requiredAmount = Math.max(0, Math.ceil(shortfall));
  router.push(
    `/wallet?action=fund&requiredAmount=${requiredAmount}&returnTo=${encodeURIComponent(returnToHref)}`
  );
}
