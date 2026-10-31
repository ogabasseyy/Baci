import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { onboardPiggyvestPrimaryWallet } from './primary-wallet-onboarding';
import {
  OTHER_WALLET_ID,
  onboardingFixture,
  PAYOUT_WALLET_ID,
  routedWallet,
} from './primary-wallet-onboarding.test-fixture';

const mocks = vi.hoisted(() => ({ alert: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: mocks.alert }));

const KEPT = {
  providerCustomerId: 'customer-fixture',
  providerWalletId: 'wallet-fixture',
  // The routing the customer was created with, rechecked later.
  interestPayoutWalletId: PAYOUT_WALLET_ID,
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
  beforeEach(() => vi.clearAllMocks());

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
    // claim_onboarding as the database answers it: an 'unknown' intent is
    // re-claimed (creation re-dispatched), a routing-pending one is not.
    let state: 'none' | 'unknown' | 'routing_pending' = 'none';
    input.storage.recordUncertain.mockImplementation(async () => {
      state = 'unknown';
    });
    input.storage.recordRoutingPending.mockImplementation(async () => {
      state = 'routing_pending';
      return true;
    });
    input.storage.claim.mockImplementation(async () =>
      state === 'routing_pending'
        ? { status: 'pending' }
        : {
            status: 'claimed',
            intentId: 'intent',
            claimToken: 'claim',
            reclaimed: state === 'unknown',
          }
    );
    await onboardPiggyvestPrimaryWallet(input);
    expect(state).toBe('routing_pending');
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.createCustomer).toHaveBeenCalledOnce();
    expect(input.retrieveWallet).toHaveBeenCalledOnce();
  });

  it('alerts operations, with only the intent id, when the readback contradicts the routing at onboarding', async () => {
    const input = onboardingFixture();
    input.retrieveWallet.mockResolvedValue(
      routedWallet({ interest_payout_wallet: OTHER_WALLET_ID })
    );
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'conflict',
      code: 'INTEREST_ROUTING_REVIEW_REQUIRED',
    });
    expect(mocks.alert).toHaveBeenCalledExactlyOnceWith(
      'PIGGYVEST_PRIMARY_ROUTING_NEEDS_REVIEW',
      expect.objectContaining({ operationId: 'intent' })
    );
    const alerted = JSON.stringify(mocks.alert.mock.calls);
    for (const secret of [OTHER_WALLET_ID, PAYOUT_WALLET_ID, 'wallet-fixture'])
      expect(alerted).not.toContain(secret);
  });

  it('reports storage unavailable, never discarding the ids as unknown, when keeping them throws', async () => {
    const input = onboardingFixture();
    input.storage.recordRoutingPending.mockRejectedValue(
      new Error('Primary wallet storage unavailable')
    );
    input.retrieveWallet.mockResolvedValue(
      routedWallet({ interest_payout_wallet: null })
    );
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(input.storage.recordUncertain).not.toHaveBeenCalled();
    expect(input.storage.releaseIntent).not.toHaveBeenCalled();
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
