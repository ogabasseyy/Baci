import 'server-only';
import { createHmac } from 'node:crypto';
import {
  piggyvestPrimaryWalletCreationSchema,
  piggyvestPrimaryWalletIdentitySchema,
  piggyvestPrimaryWalletOnboardingConfigurationSchema,
  piggyvestPrimaryWalletOnboardingSchema,
} from '@/schemas/piggyvest-primary-wallet-onboarding';
import { PiggyvestApiError } from './client';
import { readPrimaryWalletInterestRouting } from './primary-wallet-interest-routing';
import type {
  PrimaryWalletCustomerRequest,
  PrimaryWalletIntentScope,
  PrimaryWalletOnboardingStorage,
} from './primary-wallet-onboarding.types';

type Input = {
  configuration: unknown;
  verifiedIdentity: unknown;
  request: unknown;
  storage: PrimaryWalletOnboardingStorage;
  createCustomer: (request: PrimaryWalletCustomerRequest) => Promise<unknown>;
  retrieveWallet: (walletId: string) => Promise<unknown>;
};

type Outcome = {
  status: 'pending' | 'ready' | 'conflict' | 'rejected' | 'unavailable';
  code?:
    | 'NOT_CONFIGURED'
    | 'INVALID_INPUT'
    | 'INVALID_BVN'
    | 'OWNERSHIP_REVIEW_REQUIRED'
    | 'INTEREST_ROUTING_REVIEW_REQUIRED'
    | 'STORAGE_UNAVAILABLE';
};

export async function onboardPiggyvestPrimaryWallet(
  input: Input
): Promise<Outcome> {
  // Without a valid Ogabassey payout wallet nothing is claimed or created:
  // interest settings are immutable, so an unrouted main wallet is forever.
  const config = piggyvestPrimaryWalletOnboardingConfigurationSchema.safeParse(
    input.configuration
  );
  const identity = piggyvestPrimaryWalletIdentitySchema.safeParse(
    input.verifiedIdentity
  );
  const request = piggyvestPrimaryWalletOnboardingSchema.safeParse(
    input.request
  );
  if (!config.success) return { status: 'unavailable', code: 'NOT_CONFIGURED' };
  if (!identity.success || !request.success)
    return { status: 'unavailable', code: 'INVALID_INPUT' };
  if (config.data.merchantId !== identity.data.merchantId) {
    return { status: 'unavailable', code: 'NOT_CONFIGURED' };
  }

  const scope: PrimaryWalletIntentScope = {
    merchantId: identity.data.merchantId,
    customerId: identity.data.customerId,
    userId: identity.data.userId,
    integrationId: config.data.integrationId,
    businessId: config.data.businessId,
    environment: config.data.environment,
  };
  const providerRequest: PrimaryWalletCustomerRequest = {
    bvn: request.data.bvn,
    email: identity.data.email.toLowerCase(),
    name: identity.data.name.normalize('NFKC'),
    phone: identity.data.phone,
    third_party_identifier: `baci:${scope.integrationId}:${scope.customerId}`,
    // Owner decision: main-wallet interest goes to Ogabassey (the customer
    // terms say the wallet balance earns no interest). It must be set here.
    enable_interest_accrual: true,
    interest_payout_wallet: config.data.interestPayoutWalletId,
  };
  // Idempotency commitment: HMAC-SHA256 keyed by a server secret is
  // already one-way — hashing the BVN before this step would be
  // cryptographically equivalent while preserving the same determinism
  // (identical scope+request must yield an identical fingerprint, or
  // dedup cannot work). Only the 64-hex digest is persisted or compared
  // (see the never-raw-BVN test); the raw value travels solely to the
  // provider request, and nothing on this path logs the HMAC input.
  const requestFingerprint = createHmac('sha256', config.data.fingerprintKey)
    .update(JSON.stringify({ scope, request: providerRequest }))
    .digest('hex');

  let claim: Awaited<ReturnType<PrimaryWalletOnboardingStorage['claim']>>;
  try {
    claim = await input.storage.claim({ ...scope, requestFingerprint });
  } catch {
    return { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
  }
  if (claim.status !== 'claimed') return { status: claim.status };
  const claimedScope = {
    ...scope,
    intentId: claim.intentId,
    claimToken: claim.claimToken,
  };

  try {
    const result = piggyvestPrimaryWalletCreationSchema.safeParse(
      await input.createCustomer(providerRequest)
    );
    if (!result.success) {
      await input.storage.recordUncertain(claimedScope);
      return { status: 'conflict', code: 'OWNERSHIP_REVIEW_REQUIRED' };
    }
    if (!result.data.new_customer && claim.reclaimed !== true) {
      // An explicit existing-customer response is an ownership verdict,
      // not transport ambiguity: record it as terminally rejected so a
      // retry can never reclaim this intent and adopt the unrelated
      // provider wallet behind the reviewer's back.
      await input.storage.recordRejected(claimedScope);
      return { status: 'conflict', code: 'OWNERSHIP_REVIEW_REQUIRED' };
    }
    // Read the wallet back before recording it: accepted intents are usable,
    // so routing must be proven first, and never assumed on a failed read.
    const routing = await readPrimaryWalletInterestRouting({
      walletId: result.data.wallet_id,
      customerId: result.data.customer_id,
      businessId: scope.businessId,
      payoutWalletId: config.data.interestPayoutWalletId,
      retrieveWallet: input.retrieveWallet,
    });
    // A failed read, or settings not shown yet, proves nothing either way:
    // keep the intent reclaimable so a retry re-reads it. A reclaimed retry
    // of a wallet this flow created comes back new_customer false, so that
    // flag cannot tell "still settling" from "predates routing"; only a
    // contradicting readback is final.
    if (routing === 'unreadable' || routing === 'unsettled') {
      await input.storage.recordUncertain(claimedScope);
      return { status: 'pending' };
    }
    if (routing !== 'routed') {
      await input.storage.recordRejected(claimedScope);
      return { status: 'conflict', code: 'INTEREST_ROUTING_REVIEW_REQUIRED' };
    }
    // A reclaimed intent retries the same fingerprinted request, so when
    // the provider's idempotent creation returns the existing customer
    // (now proven routed), adopt those identifiers instead of stranding
    // the wallet unknown.
    const recorded = await input.storage.recordAccepted({
      ...claimedScope,
      providerCustomerId: result.data.customer_id,
      providerWalletId: result.data.wallet_id,
    });
    return recorded
      ? { status: 'pending' }
      : { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
  } catch (error) {
    // A definitive decline means nothing was created: release the intent so
    // a corrected request can claim again. Recording it uncertain would pin
    // the declined fingerprint and conflict every corrected retry. A decline
    // that names the interest settings is our configured payout wallet being
    // refused, never the customer's BVN. Every other throw stays ambiguous.
    const decline = classifyCreationDecline(error);
    if (decline !== null) {
      try {
        if (!(await input.storage.releaseIntent(claimedScope)))
          return { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
      } catch {
        return { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
      }
      return decline === 'interest_routing'
        ? { status: 'unavailable', code: 'NOT_CONFIGURED' }
        : { status: 'rejected', code: 'INVALID_BVN' };
    }
    try {
      await input.storage.recordUncertain(claimedScope);
    } catch {
      return { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
    }
    return { status: 'pending' };
  }
}

function classifyCreationDecline(
  error: unknown
): 'interest_routing' | 'bvn' | null {
  if (!(error instanceof PiggyvestApiError)) return null;
  if (
    error.declined &&
    (error.status === 400 || error.status === 422) &&
    /payout|interest/i.test(error.message)
  )
    return 'interest_routing';
  // Only 400 is a BVN verdict; every other status stays transport-ambiguous.
  return error.status === 400 ? 'bvn' : null;
}
