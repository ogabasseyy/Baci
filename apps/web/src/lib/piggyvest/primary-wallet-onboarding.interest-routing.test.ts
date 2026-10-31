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
    expect(input.storage.recordRejected).toHaveBeenCalledOnce();
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
    expect(input.storage.recordUncertain).not.toHaveBeenCalled();
  });

  it.each([
    [
      'interest disabled, no payout',
      { interest_enabled: false, interest_payout_wallet: null },
    ],
    [
      'settings absent',
      { interest_enabled: undefined, interest_payout_wallet: undefined },
    ],
    ['payout set, accrual off', { interest_enabled: false }],
  ])('sends an existing returnIfExist customer with %s to review instead of adopting it', async (_label, overrides) => {
    const input = reclaimedExisting();
    input.retrieveWallet.mockResolvedValue(routedWallet(overrides));
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual(REVIEW);
    expect(input.storage.recordRejected).toHaveBeenCalledOnce();
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
  });

  it('adopts an existing returnIfExist customer only when its readback proves the routing', async () => {
    const input = reclaimedExisting();
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.storage.recordAccepted).toHaveBeenCalledOnce();
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
  });

  it('keeps a just-created wallet whose interest settings are not readable yet uncertain, never ready or rejected', async () => {
    const input = onboardingFixture();
    input.retrieveWallet.mockResolvedValue(
      routedWallet({ interest_payout_wallet: null })
    );
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.storage.recordUncertain).toHaveBeenCalledOnce();
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
  });

  it.each([
    ['times out', new PiggyvestApiError('PIGGYVEST_NETWORK_ERROR', 'timeout')],
    [
      'is declined with 400',
      new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'Bad request', 400),
    ],
    ['fails unexpectedly', new Error('private provider response')],
  ])('never assumes routing when the readback %s', async (_label, error) => {
    const input = onboardingFixture();
    input.retrieveWallet.mockRejectedValue(error);
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    // The customer exists at the provider: a readback failure must never
    // release the intent as if creation had been declined.
    expect(input.storage.releaseIntent).not.toHaveBeenCalled();
    expect(input.storage.recordUncertain).toHaveBeenCalledOnce();
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
    expect(input.createCustomer).toHaveBeenCalledOnce();
  });

  it('binds the payout wallet into the idempotency fingerprint', async () => {
    const first = onboardingFixture();
    const second = onboardingFixture();
    second.configuration.interestPayoutWalletId = OTHER_WALLET_ID;
    await onboardPiggyvestPrimaryWallet(first);
    await onboardPiggyvestPrimaryWallet(second);
    expect(first.storage.claim.mock.calls[0][0].requestFingerprint).not.toBe(
      second.storage.claim.mock.calls[0][0].requestFingerprint
    );
  });
});
