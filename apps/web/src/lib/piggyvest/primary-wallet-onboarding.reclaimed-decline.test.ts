import { describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { onboardPiggyvestPrimaryWallet } from './primary-wallet-onboarding';
import {
  customerListing,
  onboardingFixture,
} from './primary-wallet-onboarding.test-fixture';

vi.mock('server-only', () => ({}));

const RECLAIMED = {
  status: 'claimed',
  intentId: 'intent',
  claimToken: 'claim',
  reclaimed: true,
};

function payoutDecline(status: number) {
  return new PiggyvestApiError(
    'PIGGYVEST_REQUEST_ERROR',
    'Invalid interest payout wallet',
    status,
    true
  );
}

function bvnDecline() {
  return new PiggyvestApiError(
    'PIGGYVEST_REQUEST_ERROR',
    'Invalid BVN',
    400,
    true
  );
}

describe('primary wallet onboarding: payout decline on a reclaimed claim', () => {
  it.each([
    400, 422,
  ])('keeps a reclaimed intent reclaimable on a %s payout decline, since an earlier dispatch may have created the customer', async (status) => {
    const input = onboardingFixture();
    input.storage.claim.mockResolvedValue(RECLAIMED);
    input.createCustomer.mockRejectedValue(payoutDecline(status));
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'NOT_CONFIGURED',
    });
    expect(input.storage.recordUncertain).toHaveBeenCalledOnce();
    expect(input.storage.releaseIntent).not.toHaveBeenCalled();
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
    expect(input.retrieveWallet).not.toHaveBeenCalled();
  });

  it('adopts the customer the lost first attempt created once the payout wallet works again', async () => {
    const input = onboardingFixture();
    input.storage.claim.mockResolvedValue(RECLAIMED);
    input.createCustomer.mockRejectedValueOnce(payoutDecline(422));
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'NOT_CONFIGURED',
    });
    // Next attempt: the intent was kept, so it is reclaimed again and
    // returnIfExist hands back the earlier customer, routed.
    input.createCustomer.mockResolvedValueOnce({
      customer_id: 'customer-fixture',
      wallet_id: 'wallet-fixture',
      new_customer: false,
    });
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.storage.recordAccepted).toHaveBeenCalledOnce();
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
    expect(input.storage.releaseIntent).not.toHaveBeenCalled();
  });

  it('reports storage unavailable when the reclaimed intent cannot be kept', async () => {
    const input = onboardingFixture();
    input.storage.claim.mockResolvedValue(RECLAIMED);
    input.storage.recordUncertain.mockRejectedValue(new Error('storage down'));
    input.createCustomer.mockRejectedValue(payoutDecline(400));
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(input.storage.releaseIntent).not.toHaveBeenCalled();
  });

  it('still releases a fresh claim on a payout decline, since nothing was created', async () => {
    const input = onboardingFixture();
    input.createCustomer.mockRejectedValue(payoutDecline(422));
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'NOT_CONFIGURED',
    });
    expect(input.storage.releaseIntent).toHaveBeenCalledOnce();
    expect(input.storage.recordUncertain).not.toHaveBeenCalled();
  });

  it('still releases a reclaimed claim on a BVN decline when the lookup proved no customer exists, so a corrected BVN can be claimed', async () => {
    const input = onboardingFixture();
    input.storage.claim.mockResolvedValue(RECLAIMED);
    input.findCustomers.mockResolvedValue(customerListing([]));
    input.createCustomer.mockRejectedValue(bvnDecline());
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'rejected',
      code: 'INVALID_BVN',
    });
    expect(input.storage.releaseIntent).toHaveBeenCalledOnce();
  });

  it('never releases a reclaimed claim whose lookup found our customer: a 400 keeps it reclaimable for adoption', async () => {
    // Releasing would make the next attempt a fresh claim, which treats our
    // own existing customer as someone else's and loses track of its DVA.
    const input = onboardingFixture();
    input.storage.claim.mockResolvedValue(RECLAIMED);
    input.createCustomer.mockRejectedValue(bvnDecline());
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.storage.releaseIntent).not.toHaveBeenCalled();
    expect(input.storage.recordUncertain).toHaveBeenCalledOnce();
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
  });
});
