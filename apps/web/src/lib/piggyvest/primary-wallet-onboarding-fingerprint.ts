import 'server-only';
import { createHmac } from 'node:crypto';
import type { PrimaryWalletIntentScope } from './primary-wallet-onboarding.types';

/** The customer's own submitted identity, as sent to PiggyVest. */
export interface PrimaryWalletOnboardingIdentity {
  bvn: string;
  email: string;
  name: string;
  phone: string;
  third_party_identifier: string;
}

/**
 * Idempotency commitments for one onboarding submission.
 *
 * HMAC-SHA256 keyed by a server secret is already one-way: hashing the BVN
 * first would be cryptographically equivalent while keeping the same
 * determinism (identical scope and request must give an identical
 * fingerprint, or dedup cannot work). Only the 64-hex digest is persisted
 * or compared; nothing here logs the HMAC input.
 *
 * - `current` pins the scope and the customer's identity. Interest routing
 *   is server configuration, kept out so that correcting the payout wallet
 *   never turns an in-flight intent into a permanent conflict; every reclaim
 *   is gated on a provider lookup instead.
 * - `legacy` is the commitment intents were stored with before main-wallet
 *   interest routing: the same scope and identity plus the then-fixed
 *   `enable_interest_accrual: false`. It is compared only after the current
 *   one conflicts, so such an intent reaches the same lookup-gated reclaim.
 */
export function primaryWalletOnboardingFingerprints(input: {
  key: string;
  scope: PrimaryWalletIntentScope;
  identity: PrimaryWalletOnboardingIdentity;
}): { current: string; legacy: string } {
  const identity = {
    bvn: input.identity.bvn,
    email: input.identity.email,
    name: input.identity.name,
    phone: input.identity.phone,
    third_party_identifier: input.identity.third_party_identifier,
  };
  const digest = (request: object) =>
    createHmac('sha256', input.key)
      .update(JSON.stringify({ scope: input.scope, request }))
      .digest('hex');
  return {
    current: digest(identity),
    legacy: digest({ ...identity, enable_interest_accrual: false }),
  };
}
