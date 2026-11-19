import 'server-only';
import { lookupPrimaryWalletCustomer } from './primary-wallet-customer-lookup';
import type {
  PrimaryWalletClaim,
  PrimaryWalletIntentScope,
  PrimaryWalletOnboardingStorage,
} from './primary-wallet-onboarding.types';

/**
 * Claim this customer's onboarding intent. Storage failures throw.
 *
 * An intent is locked to the details it was first sent with. An intent
 * stored before main-wallet interest routing carries the earlier commitment
 * to this same identity, so that fingerprint is tried next: it reconciles
 * through the lookup-gated reclaim rather than stay a permanent conflict.
 *
 * Still in conflict, the earlier attempt may have created a PiggyVest
 * customer under the old details, and adopting it under new ones would bind
 * a wallet to the wrong BVN. Only when PiggyVest's own listing for this
 * account's identifier (not BVN-based) is complete and empty may the
 * database re-fingerprint the intent, and only while it is unresolved,
 * walletless and unreviewed. Whatever customer the create that follows
 * returns, new or existing, is judged refreshed_review: never adopted, its
 * ids kept for ownership review. Any other lookup answer keeps the conflict.
 */
export async function claimPrimaryWalletOnboarding(input: {
  storage: PrimaryWalletOnboardingStorage;
  scope: PrimaryWalletIntentScope;
  fingerprints: { current: string; legacy: string };
  thirdPartyIdentifier: string;
  findCustomers: (thirdPartyIdentifier: string) => Promise<unknown>;
}): Promise<PrimaryWalletClaim> {
  const { storage, scope, fingerprints } = input;
  const claim = await storage.claim({
    ...scope,
    requestFingerprint: fingerprints.current,
  });
  if (claim.status !== 'conflict') return claim;
  const legacy = await storage.claim({
    ...scope,
    requestFingerprint: fingerprints.legacy,
  });
  if (legacy.status !== 'conflict') return legacy;
  const lookup = await lookupPrimaryWalletCustomer({
    thirdPartyIdentifier: input.thirdPartyIdentifier,
    findCustomers: input.findCustomers,
  });
  if (lookup.kind !== 'none') return legacy;
  return storage.refreshUnknown({
    ...scope,
    requestFingerprint: fingerprints.current,
  });
}
