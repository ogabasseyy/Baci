import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import { readPiggyvestCapabilityNow } from '@/lib/read-piggyvest-capability-now';
import { useAuthStore } from '@/stores/auth-store';

/**
 * True while a legacy (non-PiggyVest) funding account would be shown but
 * the merchant's PiggyVest status is still unknown: the account may come
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
  const capability = usePiggyvestPrimaryCapability(merchantId);
  if (!provider || provider === 'piggyvest') {
    return false;
  }
  return capability === null && readPiggyvestCapabilityNow(merchantId) === null;
}
