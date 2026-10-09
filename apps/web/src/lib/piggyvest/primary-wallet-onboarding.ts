import 'server-only';
import { createHmac } from 'node:crypto';
import {
  piggyvestPrimaryWalletConfigurationSchema,
  piggyvestPrimaryWalletCreationSchema,
  piggyvestPrimaryWalletIdentitySchema,
  piggyvestPrimaryWalletOnboardingSchema,
} from '@/schemas/piggyvest-primary-wallet-onboarding';
import { PiggyvestApiError } from './client';
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
};

type Outcome = {
  status: 'pending' | 'ready' | 'conflict' | 'rejected' | 'unavailable';
  code?:
    | 'NOT_CONFIGURED'
    | 'INVALID_INPUT'
    | 'INVALID_BVN'
    | 'OWNERSHIP_REVIEW_REQUIRED'
    | 'STORAGE_UNAVAILABLE';
};

export async function onboardPiggyvestPrimaryWallet(
  input: Input
): Promise<Outcome> {
  const config = piggyvestPrimaryWalletConfigurationSchema.safeParse(
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
    enable_interest_accrual: false,
  };
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
    // A reclaimed intent retries the same fingerprinted request, so when
    // the provider's idempotent creation returns the existing customer,
    // adopt those identifiers instead of stranding the wallet unknown.
    if (!result.data.new_customer) {
      const adopted = await input.storage.recordAccepted({
        ...claimedScope,
        providerCustomerId: result.data.customer_id,
        providerWalletId: result.data.wallet_id,
      });
      return adopted
        ? { status: 'pending' }
        : { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
    }
    const recorded = await input.storage.recordAccepted({
      ...claimedScope,
      providerCustomerId: result.data.customer_id,
      providerWalletId: result.data.wallet_id,
    });
    return recorded
      ? { status: 'pending' }
      : { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
  } catch (error) {
    // A definitive provider validation rejection (HTTP 400) means nothing
    // was created: release the uncreated intent so the customer can
    // correct the BVN. Recording it uncertain would pin the wrong-value
    // fingerprint and conflict every corrected retry permanently. Only
    // 400 qualifies — every other throw stays transport-ambiguous.
    if (error instanceof PiggyvestApiError && error.status === 400) {
      try {
        const released = await input.storage.releaseIntent(claimedScope);
        return released
          ? { status: 'rejected', code: 'INVALID_BVN' }
          : { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
      } catch {
        return { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
      }
    }
    try {
      await input.storage.recordUncertain(claimedScope);
    } catch {
      return { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
    }
    return { status: 'pending' };
  }
}
