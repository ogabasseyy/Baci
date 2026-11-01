import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { onboardPiggyvestPrimaryWallet } from './primary-wallet-onboarding';
import {
  customerListing,
  onboardingFixture,
  PAYOUT_WALLET_ID,
  routedWallet,
  THIRD_PARTY_IDENTIFIER,
} from './primary-wallet-onboarding.test-fixture';

vi.mock('server-only', () => ({}));

// The commitment an intent was stored with before main-wallet interest
// routing: the same scope and identity plus the then-fixed accrual flag.
function legacyFingerprint(input: ReturnType<typeof onboardingFixture>) {
  const scope = {
    merchantId: input.verifiedIdentity.merchantId,
    customerId: input.verifiedIdentity.customerId,
    userId: input.verifiedIdentity.userId,
    integrationId: input.configuration.integrationId,
    businessId: input.configuration.businessId,
    environment: input.configuration.environment,
  };
  const request = {
    bvn: input.request.bvn,
    email: input.verifiedIdentity.email.toLowerCase(),
    name: input.verifiedIdentity.name,
    phone: input.verifiedIdentity.phone,
    third_party_identifier: THIRD_PARTY_IDENTIFIER,
    enable_interest_accrual: false,
  };
  return createHmac('sha256', input.configuration.fingerprintKey)
    .update(JSON.stringify({ scope, request }))
    .digest('hex');
}

describe('primary wallet onboarding: intents stored before interest routing', () => {
  it('reconciles an earlier intent through its stored commitment and the reclaim lookup, creating once', async () => {
    const input = onboardingFixture();
    input.storage.claim
      .mockResolvedValueOnce({ status: 'conflict' })
      .mockResolvedValueOnce({
        status: 'claimed',
        intentId: 'intent',
        claimToken: 'claim',
        reclaimed: true,
      });
    input.findCustomers.mockResolvedValue(customerListing([]));
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    const [current, legacy] = input.storage.claim.mock.calls.map(
      ([command]) => command.requestFingerprint
    );
    expect(legacy).toBe(legacyFingerprint(input));
    expect(current).not.toBe(legacy);
    expect(input.findCustomers).toHaveBeenCalledOnce();
    expect(input.createCustomer).toHaveBeenCalledOnce();
    // Re-dispatched as today's request, never the stored one: routed.
    expect(input.createCustomer.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        enable_interest_accrual: true,
        interest_payout_wallet: PAYOUT_WALLET_ID,
      })
    );
    expect(input.storage.recordAccepted).toHaveBeenCalledOnce();
  });

  it('sends the customer an earlier intent created to routing review, with no second create', async () => {
    const input = onboardingFixture();
    input.storage.claim
      .mockResolvedValueOnce({ status: 'conflict' })
      .mockResolvedValueOnce({
        status: 'claimed',
        intentId: 'intent',
        claimToken: 'claim',
        reclaimed: true,
      });
    input.createCustomer.mockResolvedValue({
      customer_id: 'customer-fixture',
      wallet_id: 'wallet-fixture',
      new_customer: false,
    });
    // The earlier format always created customers with accrual off, and
    // interest settings are fixed at creation: it can never be routed.
    input.retrieveWallet.mockResolvedValue(
      routedWallet({ interest_enabled: false, interest_payout_wallet: null })
    );
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'conflict',
      code: 'INTEREST_ROUTING_REVIEW_REQUIRED',
    });
    // The single call is the idempotent returnIfExist request: it creates
    // nothing for an existing customer and names its main wallet.
    expect(input.createCustomer).toHaveBeenCalledOnce();
    expect(input.storage.recordReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        providerCustomerId: 'customer-fixture',
        providerWalletId: 'wallet-fixture',
      })
    );
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
    expect(input.storage.recordRoutingPending).not.toHaveBeenCalled();
  });

  it('stays in conflict, contacting no provider, when neither commitment matches', async () => {
    const input = onboardingFixture();
    input.storage.claim.mockResolvedValue({ status: 'conflict' });
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'conflict',
    });
    expect(input.storage.claim).toHaveBeenCalledTimes(2);
    expect(input.findCustomers).not.toHaveBeenCalled();
    expect(input.createCustomer).not.toHaveBeenCalled();
  });

  it.each([
    ['claimed', { status: 'claimed', intentId: 'intent', claimToken: 'claim' }],
    ['pending', { status: 'pending' }],
    ['ready', { status: 'ready' }],
  ])('never tries the earlier commitment when the current one is %s', async (_label, answer) => {
    const input = onboardingFixture();
    input.storage.claim.mockResolvedValue(answer);
    await onboardPiggyvestPrimaryWallet(input);
    expect(input.storage.claim).toHaveBeenCalledOnce();
  });

  it('reports storage unavailable when the earlier commitment cannot be checked', async () => {
    const input = onboardingFixture();
    input.storage.claim
      .mockResolvedValueOnce({ status: 'conflict' })
      .mockRejectedValueOnce(new Error('storage down'));
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(input.createCustomer).not.toHaveBeenCalled();
  });
});
