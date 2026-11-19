import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { onboardPiggyvestPrimaryWallet } from './primary-wallet-onboarding';
import {
  customerListing,
  OTHER_WALLET_ID,
  onboardingFixture,
  PAYOUT_WALLET_ID,
} from './primary-wallet-onboarding.test-fixture';

const mocks = vi.hoisted(() => ({ alert: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: mocks.alert }));

const RECLAIMED = {
  status: 'claimed',
  intentId: 'intent',
  claimToken: 'claim',
  reclaimed: true,
};
const OWNERSHIP = { status: 'conflict', code: 'OWNERSHIP_REVIEW_REQUIRED' };

function reclaimed() {
  const input = onboardingFixture();
  input.storage.claim.mockResolvedValue(RECLAIMED);
  return input;
}

// Nothing about the answered customer was recorded or made usable.
function expectNothingAdopted(input: ReturnType<typeof onboardingFixture>) {
  expect(input.storage.recordAccepted).not.toHaveBeenCalled();
  expect(input.storage.recordRoutingPending).not.toHaveBeenCalled();
  expect(input.retrieveWallet).not.toHaveBeenCalled();
}

beforeEach(() => vi.clearAllMocks());

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

  it.each([
    ['once', ['customer-fixture']],
    ['twice (the same customer)', ['customer-fixture', 'customer-fixture']],
  ])('adopts the customer the lookup found %s, through its routing readback, never as a new one', async (_label, listed) => {
    const input = reclaimed();
    input.findCustomers.mockResolvedValue(customerListing(listed));
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

  it('never adopts, and terminally rejects, another customer than the one the lookup found', async () => {
    const input = reclaimed();
    input.createCustomer.mockResolvedValue({
      customer_id: 'customer-other',
      wallet_id: 'wallet-other',
      new_customer: false,
    });
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual(OWNERSHIP);
    expectNothingAdopted(input);
    expect(input.storage.recordRejected).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ intentId: 'intent', claimToken: 'claim' })
    );
    expect(input.storage.recordOwnershipHold).not.toHaveBeenCalled();
    expect(input.storage.recordUncertain).not.toHaveBeenCalled();
  });

  it('keeps the ids of a duplicate PiggyVest created under our identifier for review in one step, never recheckable', async () => {
    const input = reclaimed();
    input.createCustomer.mockResolvedValue({
      customer_id: 'customer-duplicate',
      wallet_id: 'wallet-duplicate',
      new_customer: true,
    });
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual(OWNERSHIP);
    // Never routing pending: a recheck could prove its routing, never that
    // the duplicate is ours.
    expect(input.storage.recordReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        intentId: 'intent',
        claimToken: 'claim',
        providerCustomerId: 'customer-duplicate',
        providerWalletId: 'wallet-duplicate',
      })
    );
    expect(input.storage.recordRoutingPending).not.toHaveBeenCalled();
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
    expect(input.retrieveWallet).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledExactlyOnceWith(
      'PIGGYVEST_PRIMARY_OWNERSHIP_NEEDS_REVIEW',
      expect.objectContaining({ operationId: 'intent' })
    );
  });

  it('never adopts an existing customer the lookup did not list under our identifier, and keeps the intent reclaimable', async () => {
    // returnIfExist can match another identity (or run ahead of the listing).
    const input = reclaimed();
    input.findCustomers.mockResolvedValue(customerListing([]));
    input.createCustomer.mockResolvedValue({
      customer_id: 'customer-other',
      wallet_id: 'wallet-other',
      new_customer: false,
    });
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expectNothingAdopted(input);
    expect(input.storage.recordUncertain).toHaveBeenCalledOnce();
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledExactlyOnceWith(
      'PIGGYVEST_PRIMARY_OWNERSHIP_NEEDS_REVIEW',
      expect.objectContaining({ operationId: 'intent' })
    );
  });

  it('sends a lookup naming several customers to ownership review, with no create', async () => {
    const input = reclaimed();
    input.findCustomers.mockResolvedValue(customerListing(['a', 'b']));
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual(OWNERSHIP);
    expect(input.createCustomer).not.toHaveBeenCalled();
    expect(input.storage.recordOwnershipHold).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ intentId: 'intent', claimToken: 'claim' })
    );
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
    expect(input.storage.recordUncertain).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledExactlyOnceWith(
      'PIGGYVEST_PRIMARY_OWNERSHIP_NEEDS_REVIEW',
      expect.objectContaining({ operationId: 'intent' })
    );
  });

  it.each([
    [
      'a duplicate cannot be kept',
      (input: ReturnType<typeof onboardingFixture>) => {
        input.createCustomer.mockResolvedValue({
          customer_id: 'customer-duplicate',
          wallet_id: 'wallet-duplicate',
          new_customer: true,
        });
        input.storage.recordReview.mockRejectedValue(new Error('down'));
      },
    ],
    [
      'several customers cannot be held',
      (input: ReturnType<typeof onboardingFixture>) => {
        input.findCustomers.mockResolvedValue(customerListing(['a', 'b']));
        input.storage.recordOwnershipHold.mockRejectedValue(new Error('down'));
      },
    ],
    [
      'an unlisted existing customer cannot be recorded',
      (input: ReturnType<typeof onboardingFixture>) => {
        input.findCustomers.mockResolvedValue(customerListing([]));
        input.createCustomer.mockResolvedValue({
          customer_id: 'customer-other',
          wallet_id: 'wallet-other',
          new_customer: false,
        });
        input.storage.recordUncertain.mockRejectedValue(new Error('down'));
      },
    ],
  ])('still alerts ownership review when %s, adopting nothing', async (_label, arrange) => {
    const input = reclaimed();
    arrange(input);
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(mocks.alert).toHaveBeenCalledWith(
      'PIGGYVEST_PRIMARY_OWNERSHIP_NEEDS_REVIEW',
      expect.objectContaining({ operationId: 'intent' })
    );
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
    expect(input.storage.recordRoutingPending).not.toHaveBeenCalled();
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
    if (_label === 'several customers cannot be held') {
      expect(input.storage.recordOwnershipHold).toHaveBeenCalledOnce();
    } else {
      expect(input.storage.recordOwnershipHold).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['fails', () => Promise.reject(new Error('timeout'))],
    ['has more pages', async () => customerListing([], { hasNextPage: true })],
  ])('stays blocked, with no create, when the lookup %s', async (_label, answer) => {
    const input = reclaimed();
    input.findCustomers.mockImplementation(answer);
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.createCustomer).not.toHaveBeenCalled();
    expect(input.storage.recordUncertain).toHaveBeenCalledOnce();
  });

  it('reports storage unavailable, with no create, when an uncertain lookup cannot be recorded', async () => {
    const input = reclaimed();
    input.findCustomers.mockRejectedValue(new Error('timeout'));
    input.storage.recordUncertain.mockRejectedValue(new Error('storage down'));
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(input.createCustomer).not.toHaveBeenCalled();
  });

  it('never looks up on a fresh claim', async () => {
    const input = onboardingFixture();
    await onboardPiggyvestPrimaryWallet(input);
    expect(input.findCustomers).not.toHaveBeenCalled();
    expect(input.createCustomer).toHaveBeenCalledOnce();
  });
});
