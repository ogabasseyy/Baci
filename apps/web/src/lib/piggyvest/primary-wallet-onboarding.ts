import 'server-only';
import {
  piggyvestPrimaryWalletCreationSchema,
  piggyvestPrimaryWalletIdentitySchema,
  piggyvestPrimaryWalletOnboardingConfigurationSchema,
  piggyvestPrimaryWalletOnboardingSchema,
} from '@/schemas/piggyvest-primary-wallet-onboarding';
import { PiggyvestApiError } from './client';
import {
  lookupPrimaryWalletCustomer,
  type PrimaryWalletCustomerLookup,
} from './primary-wallet-customer-lookup';
import { readPrimaryWalletInterestRouting } from './primary-wallet-interest-routing';
import type {
  PrimaryWalletCustomerRequest,
  PrimaryWalletIntentScope,
  PrimaryWalletOnboardingStorage,
} from './primary-wallet-onboarding.types';
import {
  alertOwnershipReview,
  judgeCreatedCustomer,
  keepCreatedWalletForReview,
} from './primary-wallet-onboarding-adoption';
import { primaryWalletOnboardingFingerprints } from './primary-wallet-onboarding-fingerprint';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

type Input = {
  configuration: unknown;
  verifiedIdentity: unknown;
  request: unknown;
  storage: PrimaryWalletOnboardingStorage;
  createCustomer: (request: PrimaryWalletCustomerRequest) => Promise<unknown>;
  retrieveWallet: (walletId: string) => Promise<unknown>;
  findCustomers: (thirdPartyIdentifier: string) => Promise<unknown>;
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
  const fingerprints = primaryWalletOnboardingFingerprints({
    key: config.data.fingerprintKey,
    scope,
    identity: providerRequest,
  });

  let claim: Awaited<ReturnType<PrimaryWalletOnboardingStorage['claim']>>;
  try {
    claim = await input.storage.claim({
      ...scope,
      requestFingerprint: fingerprints.current,
    });
    // An intent stored before main-wallet interest routing carries the
    // earlier commitment to this same identity: reconcile it through the
    // lookup-gated reclaim below rather than leave it a permanent conflict.
    if (claim.status === 'conflict')
      claim = await input.storage.claim({
        ...scope,
        requestFingerprint: fingerprints.legacy,
      });
  } catch {
    return { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
  }
  if (claim.status !== 'claimed') return { status: claim.status };
  const claimedScope = {
    ...scope,
    intentId: claim.intentId,
    claimToken: claim.claimToken,
  };
  // A reclaimed intent follows an ambiguous earlier dispatch: never dispatch
  // again unless PiggyVest's own listing proves no customer was created, or
  // finds the one that was (then adopted through the routing readback).
  let lookup: PrimaryWalletCustomerLookup | null = null;
  if (claim.reclaimed === true) {
    lookup = await lookupPrimaryWalletCustomer({
      thirdPartyIdentifier: providerRequest.third_party_identifier,
      findCustomers: input.findCustomers,
    });
    if (lookup.kind === 'unknown' || lookup.kind === 'ambiguous') {
      // Several customers under our identifier is final: none is provably
      // ours. Anything else unknown may clear, so the intent stays pending.
      // Alerts go out before any write, so a storage failure never mutes one.
      if (lookup.kind === 'ambiguous')
        alertOwnershipReview('several provider customers', claim.intentId);
      try {
        if (lookup.kind === 'unknown')
          await input.storage.recordUncertain(claimedScope);
        else await input.storage.recordRejected(claimedScope);
      } catch {
        return { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
      }
      return lookup.kind === 'unknown'
        ? { status: 'pending' }
        : { status: 'conflict', code: 'OWNERSHIP_REVIEW_REQUIRED' };
    }
  }

  try {
    const result = piggyvestPrimaryWalletCreationSchema.safeParse(
      await input.createCustomer(providerRequest)
    );
    if (!result.success) {
      await input.storage.recordUncertain(claimedScope);
      return { status: 'conflict', code: 'OWNERSHIP_REVIEW_REQUIRED' };
    }
    // Only a customer proven ours is read back and adopted
    // (judgeCreatedCustomer); an explicit existing-customer answer that is
    // not is an ownership verdict, so it is terminally rejected and a retry
    // can never adopt it behind the reviewer's back.
    const verdict = judgeCreatedCustomer({ lookup, created: result.data });
    if (verdict === 'foreign') {
      await input.storage.recordRejected(claimedScope);
      return { status: 'conflict', code: 'OWNERSHIP_REVIEW_REQUIRED' };
    }
    if (verdict === 'unproven') {
      alertOwnershipReview('existing customer not listed', claim.intentId);
      await input.storage.recordUncertain(claimedScope);
      return { status: 'pending' };
    }
    if (verdict === 'duplicate') {
      alertOwnershipReview('duplicate provider customer', claim.intentId);
      const kept = await keepCreatedWalletForReview({
        storage: input.storage,
        claimedScope,
        providerCustomerId: result.data.customer_id,
        providerWalletId: result.data.wallet_id,
      });
      return kept
        ? { status: 'conflict', code: 'OWNERSHIP_REVIEW_REQUIRED' }
        : { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
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
    // A failed read, or settings not shown yet, proves nothing either way,
    // and new_customer cannot tell "still settling" from "predates routing";
    // only a contradicting readback is final. The customer exists, so keep
    // its ids in the unusable routing-pending state: a status refresh
    // re-reads it (recoverPrimaryWalletRouting) without another create or a
    // second BVN submission, and claim_onboarding never re-dispatches it.
    if (routing === 'unreadable' || routing === 'unsettled') {
      // A storage failure here is reported as such, never folded into the
      // generic catch below (which would discard the ids as 'unknown').
      let kept = false;
      try {
        kept = await input.storage.recordRoutingPending({
          ...claimedScope,
          providerCustomerId: result.data.customer_id,
          providerWalletId: result.data.wallet_id,
          interestPayoutWalletId: config.data.interestPayoutWalletId,
        });
      } catch {
        kept = false;
      }
      return kept
        ? { status: 'pending' }
        : { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
    }
    if (routing !== 'routed') {
      // The created wallet holds a real DVA: keep its ids for review and DVA
      // closure before any deletion. Interest settings are immutable.
      emitPiggyvestWebhookAlert('PIGGYVEST_PRIMARY_ROUTING_NEEDS_REVIEW', {
        reason: 'main wallet interest routing contradicted at onboarding',
        operationId: claimedScope.intentId,
      });
      const kept = await keepCreatedWalletForReview({
        storage: input.storage,
        claimedScope,
        providerCustomerId: result.data.customer_id,
        providerWalletId: result.data.wallet_id,
      });
      return kept
        ? { status: 'conflict', code: 'INTEREST_ROUTING_REVIEW_REQUIRED' }
        : { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
    }
    // A reclaimed intent retries the same fingerprinted request, so when
    // the provider's idempotent creation returns the customer the lookup
    // found (now proven routed), adopt those identifiers instead of
    // stranding the wallet unknown.
    const recorded = await input.storage.recordAccepted({
      ...claimedScope,
      providerCustomerId: result.data.customer_id,
      providerWalletId: result.data.wallet_id,
    });
    return recorded
      ? { status: 'pending' }
      : { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
  } catch (error) {
    // A decline that names the interest settings is our configured payout
    // wallet being refused, never the customer's BVN. On a fresh claim it
    // proves nothing was created, so the intent is released for a corrected
    // request. On a reclaimed claim it proves only that THIS attempt created
    // nothing: the earlier dispatch may have created the customer, so the
    // intent stays reclaimable and a later retry can adopt it. A BVN decline
    // is released so a corrected BVN can be claimed, unless the lookup found
    // our customer: releasing would make the next attempt a fresh claim that
    // refuses it. Every other throw stays ambiguous.
    const decline = classifyCreationDecline(error);
    const keepReclaimable =
      decline === 'interest_routing'
        ? claim.reclaimed === true
        : lookup?.kind === 'found';
    if (decline !== null && !keepReclaimable) {
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
    return decline === 'interest_routing'
      ? { status: 'unavailable', code: 'NOT_CONFIGURED' }
      : { status: 'pending' };
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
