import { describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { onboardPiggyvestPrimaryWallet } from './primary-wallet-onboarding';
import {
  onboardingFixture,
  routedWallet,
} from './primary-wallet-onboarding.test-fixture';

vi.mock('server-only', () => ({}));

const KEPT = {
  providerCustomerId: 'customer-fixture',
  providerWalletId: 'wallet-fixture',
};

function existingCustomer() {
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

describe('primary wallet onboarding: routing not proven yet', () => {
  it.each([
    ['the payout is not shown yet', { interest_payout_wallet: null }],
    [
      'the settings are absent',
      { interest_enabled: undefined, interest_payout_wallet: undefined },
    ],
  ])('keeps the created wallet, unusable, when %s', async (_label, overrides) => {
    const input = onboardingFixture();
    input.retrieveWallet.mockResolvedValue(routedWallet(overrides));
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    // The identifiers are kept (routing pending), never thrown away: a
    // status refresh can finish the readback without another create.
    expect(input.storage.recordRoutingPending).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ intentId: 'intent', ...KEPT })
    );
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
    expect(input.storage.recordUncertain).not.toHaveBeenCalled();
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
  });

  it.each([
    ['times out', new PiggyvestApiError('PIGGYVEST_NETWORK_ERROR', 'timeout')],
    [
      'is declined with 400',
      new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'Bad request', 400),
    ],
    ['fails unexpectedly', new Error('private provider response')],
  ])('keeps the created wallet, unusable, when the readback %s', async (_label, error) => {
    const input = onboardingFixture();
    input.retrieveWallet.mockRejectedValue(error);
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    // The customer exists at the provider: never released as if creation
    // had been declined, and never assumed routed.
    expect(input.storage.releaseIntent).not.toHaveBeenCalled();
    expect(input.storage.recordRoutingPending).toHaveBeenCalledOnce();
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
    expect(input.createCustomer).toHaveBeenCalledOnce();
  });

  it('keeps an existing returnIfExist customer whose routing is not shown yet, never adopted or rejected', async () => {
    const input = existingCustomer();
    input.retrieveWallet.mockResolvedValue(
      routedWallet({ interest_payout_wallet: null })
    );
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.storage.recordRoutingPending).toHaveBeenCalledOnce();
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
  });

  it('never creates again once the wallet is routing pending: a resubmitted setup only reports pending', async () => {
    const input = onboardingFixture();
    input.retrieveWallet.mockResolvedValue(
      routedWallet({ interest_payout_wallet: null })
    );
    await onboardPiggyvestPrimaryWallet(input);
    // claim_onboarding never reclaims a routing-pending intent.
    input.storage.claim.mockResolvedValue({ status: 'pending' });
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.createCustomer).toHaveBeenCalledOnce();
    expect(input.retrieveWallet).toHaveBeenCalledOnce();
  });

  it('reports storage unavailable when the pending wallet cannot be kept', async () => {
    const input = onboardingFixture();
    input.storage.recordRoutingPending.mockResolvedValue(false);
    input.retrieveWallet.mockResolvedValue(
      routedWallet({ interest_payout_wallet: null })
    );
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'STORAGE_UNAVAILABLE',
    });
  });
});
