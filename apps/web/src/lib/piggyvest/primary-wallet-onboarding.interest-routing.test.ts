import { describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { onboardPiggyvestPrimaryWallet } from './primary-wallet-onboarding';
import {
  OTHER_WALLET_ID,
  onboardingFixture,
  PAYOUT_WALLET_ID,
  routedWallet,
} from './primary-wallet-onboarding.test-fixture';

vi.mock('server-only', () => ({}));

function reclaimedExisting() {
  const input = onboardingFixture();
  input.storage.claim.mockResolvedValue({
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
  return input;
}

// A contradicted wallet holds a real DVA: its ids are kept on the rejected
// intent in one step for review and closure, never usable or recheckable.
function expectKeptForReview(input: ReturnType<typeof onboardingFixture>) {
  const scope = {
    merchantId: input.verifiedIdentity.merchantId,
    customerId: input.verifiedIdentity.customerId,
    userId: input.verifiedIdentity.userId,
    integrationId: input.configuration.integrationId,
    businessId: input.configuration.businessId,
    environment: input.configuration.environment,
  };
  const ids = {
    providerCustomerId: 'customer-fixture',
    providerWalletId: 'wallet-fixture',
  };
  expect(input.storage.recordReview).toHaveBeenCalledExactlyOnceWith({
    ...scope,
    intentId: 'intent',
    claimToken: 'claim',
    ...ids,
  });
  expect(input.storage.recordRoutingPending).not.toHaveBeenCalled();
  expect(input.storage.recordRejected).not.toHaveBeenCalled();
  expect(input.storage.recordAccepted).not.toHaveBeenCalled();
}

const REVIEW = {
  status: 'conflict',
  code: 'INTEREST_ROUTING_REVIEW_REQUIRED',
};

describe('primary wallet onboarding interest routing', () => {
  it('creates the main wallet with interest routed to the configured Ogabassey wallet and records it only after a matching readback', async () => {
    const input = onboardingFixture();
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.createCustomer).toHaveBeenCalledOnce();
    expect(input.createCustomer.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        enable_interest_accrual: true,
        interest_payout_wallet: PAYOUT_WALLET_ID,
      })
    );
    expect(input.retrieveWallet).toHaveBeenCalledWith('wallet-fixture');
    expect(input.retrieveWallet.mock.invocationCallOrder[0]).toBeLessThan(
      input.storage.recordAccepted.mock.invocationCallOrder[0]
    );
    expect(input.storage.recordAccepted).toHaveBeenCalledWith(
      expect.objectContaining({
        providerCustomerId: 'customer-fixture',
        providerWalletId: 'wallet-fixture',
      })
    );
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
    expect(input.storage.recordUncertain).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'not-a-wallet-id'],
    ['lowercase', PAYOUT_WALLET_ID.toLowerCase()],
  ])('is not configured with a %s payout wallet and contacts neither storage nor the provider', async (_label, interestPayoutWalletId) => {
    const input = onboardingFixture();
    input.configuration.interestPayoutWalletId = interestPayoutWalletId;
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'NOT_CONFIGURED',
    });
    expect(input.storage.claim).not.toHaveBeenCalled();
    expect(input.createCustomer).not.toHaveBeenCalled();
    expect(input.retrieveWallet).not.toHaveBeenCalled();
  });

  it.each([
    [
      'names another payout wallet',
      { interest_payout_wallet: OTHER_WALLET_ID },
    ],
    ['belongs to another customer', { api_customer_id: 'someone-else' }],
    ['is another wallet', { id: 'another-wallet' }],
    ['belongs to another business', { business_id: 'other-business' }],
  ])('sends a fresh wallet whose readback %s to review, never ready', async (_label, overrides) => {
    const input = onboardingFixture();
    input.retrieveWallet.mockResolvedValue(routedWallet(overrides));
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual(REVIEW);
    expectKeptForReview(input);
    expect(input.storage.recordUncertain).not.toHaveBeenCalled();
  });

  it.each([
    [
      'interest disabled, no payout',
      { interest_enabled: false, interest_payout_wallet: null },
    ],
    ['payout set, accrual off', { interest_enabled: false }],
  ])('sends an existing returnIfExist customer with %s to review instead of adopting it', async (_label, overrides) => {
    // Interest settings are fixed at creation, so an explicit "accrual off"
    // is a final answer, not a wallet that is still settling.
    const input = reclaimedExisting();
    input.retrieveWallet.mockResolvedValue(routedWallet(overrides));
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual(REVIEW);
    expectKeptForReview(input);
  });

  it.each([
    ['refused', async () => false],
    ['failing', () => Promise.reject(new Error('storage down'))],
  ])('still rejects a contradicted wallet when keeping its ids is %s', async (_label, review) => {
    const input = onboardingFixture();
    input.storage.recordReview.mockImplementation(review);
    input.retrieveWallet.mockResolvedValue(
      routedWallet({ interest_payout_wallet: OTHER_WALLET_ID })
    );
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual(REVIEW);
    expect(input.storage.recordRejected).toHaveBeenCalledOnce();
    expect(input.storage.recordRoutingPending).not.toHaveBeenCalled();
    expect(input.storage.recordUncertain).not.toHaveBeenCalled();
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'Invalid interest payout wallet'],
    [422, 'interest_payout_wallet must be a business wallet'],
  ])('reports a %s decline of the payout wallet as not configured, never as an invalid BVN', async (status, message) => {
    const input = onboardingFixture();
    input.createCustomer.mockRejectedValue(
      new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', message, status, true)
    );
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'NOT_CONFIGURED',
    });
    // Nothing was created: release the intent so a corrected payout wallet
    // (a new fingerprint) can be claimed, rather than pinning a conflict.
    expect(input.storage.releaseIntent).toHaveBeenCalledOnce();
    expect(input.storage.recordUncertain).not.toHaveBeenCalled();
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
    expect(input.retrieveWallet).not.toHaveBeenCalled();
  });

  it('still reports a declined BVN as an invalid BVN', async () => {
    const input = onboardingFixture();
    input.createCustomer.mockRejectedValue(
      new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'Invalid BVN', 400, true)
    );
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'rejected',
      code: 'INVALID_BVN',
    });
    expect(input.storage.releaseIntent).toHaveBeenCalledOnce();
  });

  it('keeps an undeclared payout-shaped error ambiguous', async () => {
    const input = onboardingFixture();
    input.createCustomer.mockRejectedValue(
      new PiggyvestApiError(
        'PIGGYVEST_REQUEST_ERROR',
        'interest payout service timed out',
        504,
        false
      )
    );
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.storage.recordUncertain).toHaveBeenCalledOnce();
    expect(input.storage.releaseIntent).not.toHaveBeenCalled();
  });

  it('does not claim release succeeded for a payout decline when storage fails', async () => {
    const input = onboardingFixture();
    input.storage.releaseIntent.mockResolvedValue(false);
    input.createCustomer.mockRejectedValue(
      new PiggyvestApiError(
        'PIGGYVEST_REQUEST_ERROR',
        'Invalid interest payout wallet',
        400,
        true
      )
    );
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'STORAGE_UNAVAILABLE',
    });
  });

  it('adopts an existing returnIfExist customer only when its readback proves the routing', async () => {
    const input = reclaimedExisting();
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.storage.recordAccepted).toHaveBeenCalledOnce();
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
  });

  it('keeps the payout wallet out of the fingerprint, so correcting it never strands an intent', async () => {
    const first = onboardingFixture();
    const second = onboardingFixture();
    second.configuration.interestPayoutWalletId = OTHER_WALLET_ID;
    await onboardPiggyvestPrimaryWallet(first);
    await onboardPiggyvestPrimaryWallet(second);
    expect(first.storage.claim.mock.calls[0][0].requestFingerprint).toBe(
      second.storage.claim.mock.calls[0][0].requestFingerprint
    );
    // The customer's own identity still binds it.
    const third = onboardingFixture();
    third.request.bvn = '00000000001';
    await onboardPiggyvestPrimaryWallet(third);
    expect(third.storage.claim.mock.calls[0][0].requestFingerprint).not.toBe(
      first.storage.claim.mock.calls[0][0].requestFingerprint
    );
  });
});
