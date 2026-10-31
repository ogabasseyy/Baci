import { describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { onboardPiggyvestPrimaryWallet } from './primary-wallet-onboarding';
import {
  customerListing,
  OTHER_WALLET_ID,
  onboardingFixture,
  PAYOUT_WALLET_ID,
  routedWallet,
} from './primary-wallet-onboarding.test-fixture';

vi.mock('server-only', () => ({}));

const RECLAIMED = {
  status: 'claimed',
  intentId: 'intent',
  claimToken: 'claim',
  reclaimed: true,
};

function reclaimed() {
  const input = onboardingFixture();
  input.storage.claim.mockResolvedValue(RECLAIMED);
  return input;
}

describe('primary wallet onboarding: reclaims are gated on a provider lookup', () => {
  it('recovers after the payout wallet is corrected: same fingerprint, lookup shows none, created exactly once', async () => {
    // The configured payout wallet was refused on a reclaimed attempt.
    const input = reclaimed();
    input.configuration.interestPayoutWalletId = OTHER_WALLET_ID;
    input.findCustomers.mockResolvedValue(customerListing([]));
    input.createCustomer.mockRejectedValueOnce(
      new PiggyvestApiError(
        'PIGGYVEST_REQUEST_ERROR',
        'Invalid interest payout wallet',
        422,
        true
      )
    );
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'NOT_CONFIGURED',
    });
    // Operations correct the setting; the intent is reclaimed again.
    input.configuration.interestPayoutWalletId = PAYOUT_WALLET_ID;
    input.createCustomer.mockResolvedValue({
      customer_id: 'customer-fixture',
      wallet_id: 'wallet-fixture',
      new_customer: true,
    });
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    const [first, second] = input.storage.claim.mock.calls.map(
      ([command]) => command.requestFingerprint
    );
    expect(second).toBe(first);
    expect(input.createCustomer).toHaveBeenCalledTimes(2);
    expect(input.createCustomer.mock.calls[1][0]).toEqual(
      expect.objectContaining({ interest_payout_wallet: PAYOUT_WALLET_ID })
    );
    expect(input.storage.recordAccepted).toHaveBeenCalledOnce();
  });

  it('adopts the customer the lookup found, through its routing readback, never as a new one', async () => {
    const input = reclaimed();
    input.findCustomers.mockResolvedValue(
      customerListing(['customer-fixture'])
    );
    input.createCustomer.mockResolvedValue({
      customer_id: 'customer-fixture',
      wallet_id: 'wallet-fixture',
      new_customer: false,
    });
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    // The one call is PiggyVest's idempotent returnIfExist request, the only
    // proven way to learn the existing customer's main wallet id.
    expect(input.createCustomer).toHaveBeenCalledOnce();
    expect(input.retrieveWallet).toHaveBeenCalledWith('wallet-fixture');
    expect(input.storage.recordAccepted).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'reports a new customer',
      { customer_id: 'customer-fixture', wallet_id: 'w', new_customer: true },
    ],
    [
      'returns another customer',
      { customer_id: 'customer-other', wallet_id: 'w', new_customer: false },
    ],
  ])('never adopts when the lookup found a customer but PiggyVest %s', async (_label, created) => {
    const input = reclaimed();
    input.findCustomers.mockResolvedValue(
      customerListing(['customer-fixture'])
    );
    input.createCustomer.mockResolvedValue(created);
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'conflict',
      code: 'OWNERSHIP_REVIEW_REQUIRED',
    });
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
    expect(input.retrieveWallet).not.toHaveBeenCalled();
  });

  it.each([
    ['fails', () => Promise.reject(new Error('timeout'))],
    ['has more pages', async () => customerListing([], { hasNextPage: true })],
    ['is ambiguous', async () => customerListing(['a', 'b'])],
  ])('stays blocked, with no create, when the lookup %s', async (_label, answer) => {
    const input = reclaimed();
    input.findCustomers.mockImplementation(answer);
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.createCustomer).not.toHaveBeenCalled();
    expect(input.storage.recordUncertain).toHaveBeenCalledOnce();
  });

  it('never looks up on a fresh claim', async () => {
    const input = onboardingFixture();
    await onboardPiggyvestPrimaryWallet(input);
    expect(input.findCustomers).not.toHaveBeenCalled();
    expect(input.createCustomer).toHaveBeenCalledOnce();
  });
});
