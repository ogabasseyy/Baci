import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { WALLET_FUNDING_CHECKING_STATE_ENABLED } from '@/constants/wallet-funding';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';

/**
 * Sends the customer to wallet funding (bank transfer) so they can top up
 * and retry a utility purchase. Mirrors the funding-nudge navigation:
 * when the checking-state flag is on and a return link is provided, the
 * wallet returns the customer to the prefilled purchase form after topping
 * up; otherwise it opens the wallet with no return route.
 *
 * The nonce is minted HERE, per call (never during render): it gives the
 * funding session an identity so a second attempt inside the session TTL
 * never inherits the first attempt's anchor. Deliberately NO
 * requiredAmount: it would seed the fund panel's prefill heuristic and,
 * for a no-phone customer, suppress DVA auto-creation after the phone
 * prompt — stranding a bank-transfer intent in the card path.
 */
export function navigateToWalletFunding(
  returnToHref?: WalletReturnHref | null
): void {
  if (WALLET_FUNDING_CHECKING_STATE_ENABLED && returnToHref) {
    const intentId = Crypto.randomUUID();
    router.push(
      `/wallet?action=bank-transfer&intent=${intentId}&returnTo=${encodeURIComponent(returnToHref)}`
    );
    return;
  }
  router.push({ pathname: '/wallet', params: { action: 'bank-transfer' } });
}
