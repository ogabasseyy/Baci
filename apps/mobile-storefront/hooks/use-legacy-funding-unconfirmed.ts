import { usePiggyvestCapabilityNow } from '@/hooks/use-piggyvest-capability-now';
import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { useAuthStore } from '@/stores/auth-store';

/**
 * True while a legacy (non-PiggyVest) funding account would be shown but
 * the merchant's PiggyVest status isn't a ruling-out: the account may come
 * from a wallet cached before PiggyVest was enabled, and a transfer to it
 * would land as store credit, not savings (Codex). Merchants the server
 * rules out show it as today once the probe answers.
 */
export function useLegacyFundingUnconfirmed(
  provider: string | null | undefined
): boolean {
  const merchantId = pickMerchantId(
    useAuthStore((state) => state.merchantId),
    CONFIG.MERCHANT_ID
  );
  // Re-renders on a new verdict and exactly at a ruling-out's expiry.
  const verdict = usePiggyvestCapabilityNow(merchantId);
  // No merchant resolved: there is no verdict to act on either way.
  if (!provider || !merchantId) {
    return false;
  }
  // A PiggyVest account under a current ruling-out is obsolete (Codex):
  // hidden until the reloaded wallet arrives, also if that reload fails.
  if (provider === 'piggyvest') {
    return verdict === false;
  }
  // Unknown, or PiggyVest confirmed before the wallet is reclassified
  // (Codex): only a ruling-out makes a legacy account safe to show.
  return verdict !== false;
}
