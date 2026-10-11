import { readObservedPiggyvestPrimaryCapability } from './piggyvest-primary-capability-cache';

// Pilot lifecycle: this hardcoded id is a cold-start bootstrap so the
// pilot merchant routes primary-first before any probe has run. It is a
// routing preference, never a credit bypass — server initialize still
// fail-closes with PRIMARY_CARD_NOT_READY, and the not-ready rollback
// re-routes on deprovision. The server verdict stays the rollout source
// of truth; remove this constant (relying on observed capability alone)
// once the pilot cohort is decommissioned.
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
