import { readObservedPiggyvestPrimaryCapability } from './piggyvest-primary-capability-cache';

const PILOT_MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

export function isPiggyvestPrimaryMerchant(
  merchantId?: string | null
): boolean {
  if (!merchantId) return false;
  if (merchantId === PILOT_MERCHANT_ID) return true;
  // Server-driven rollout: once the capability probe positively confirms
  // primary for a merchant, route it as primary without an app release.
  // Anything unobserved still fails closed to the pilot allowlist.
  return readObservedPiggyvestPrimaryCapability(merchantId) === true;
}
