import { describe, expect, it, vi } from 'vitest';
import { onboardPiggyvestPrimaryWallet } from './primary-wallet-onboarding';
import {
  customerListing,
  onboardingFixture,
  THIRD_PARTY_IDENTIFIER,
} from './primary-wallet-onboarding.test-fixture';

vi.mock('server-only', () => ({}));

// An intent left unresolved (for example by a rejected API key) is locked to
// the details it was first sent with: both fingerprint claims conflict.
function conflictedFixture() {
  const input = onboardingFixture();
  input.storage.claim.mockResolvedValue({ status: 'conflict' });
  return input;
}

describe('primary wallet onboarding: retry with new details after an unresolved attempt', () => {
  it('bugfix (Codex P1): re-fingerprints the intent, creates fresh, and keeps the new customer for ownership review', async () => {
    const input = conflictedFixture();
    input.findCustomers.mockResolvedValue(customerListing([]));
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'conflict',
      code: 'OWNERSHIP_REVIEW_REQUIRED',
    });
    expect(input.storage.claim).toHaveBeenCalledTimes(2);
    expect(input.findCustomers).toHaveBeenCalledExactlyOnceWith(
      THIRD_PARTY_IDENTIFIER
    );
    // Refreshed under today's fingerprint, never the legacy one.
    const current = input.storage.claim.mock.calls[0][0].requestFingerprint;
    expect(input.storage.refreshUnknown).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        customerId: input.verifiedIdentity.customerId,
        requestFingerprint: current,
      })
    );
    expect(input.createCustomer).toHaveBeenCalledOnce();
    expect(input.createCustomer.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        bvn: input.request.bvn,
        third_party_identifier: THIRD_PARTY_IDENTIFIER,
      })
    );
    // The earlier dispatch may still land later: never adopted, ids kept.
    expect(input.storage.recordReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        intentId: 'refreshed-intent',
        claimToken: 'refreshed-claim',
        providerCustomerId: 'customer-fixture',
        providerWalletId: 'wallet-fixture',
      })
    );
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
  });

  it('treats an existing-customer answer after the refresh as foreign, never adopting it', async () => {
    const input = conflictedFixture();
    input.findCustomers.mockResolvedValue(customerListing([]));
    // The earlier dispatch landed between the lookup and the create.
    input.createCustomer.mockResolvedValue({
      customer_id: 'customer-fixture',
      wallet_id: 'wallet-fixture',
      new_customer: false,
    });
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'conflict',
      code: 'OWNERSHIP_REVIEW_REQUIRED',
    });
    // bugfix (Codex P1): the existing customer's ids are kept for review and
    // DVA closure, never an id-less rejection.
    expect(input.storage.recordReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        providerCustomerId: 'customer-fixture',
        providerWalletId: 'wallet-fixture',
      })
    );
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
  });

  it('stays in conflict when the database refuses the refresh', async () => {
    const input = conflictedFixture();
    input.findCustomers.mockResolvedValue(customerListing([]));
    input.storage.refreshUnknown.mockResolvedValue({ status: 'conflict' });
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'conflict',
    });
    expect(input.storage.refreshUnknown).toHaveBeenCalledOnce();
    expect(input.createCustomer).not.toHaveBeenCalled();
  });

  it.each([
    ['found', customerListing(['customer-fixture'])],
    ['ambiguous', customerListing(['customer-a', 'customer-b'])],
    ['unknown (more pages)', customerListing([], { hasNextPage: true })],
    ['unknown (foreign edge)', customerListing(['x'], { identifier: 'other' })],
  ])('keeps the conflict for review, with no refresh or create, when the lookup is %s', async (_label, listing) => {
    const input = conflictedFixture();
    input.findCustomers.mockResolvedValue(listing);
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'conflict',
    });
    expect(input.findCustomers).toHaveBeenCalledOnce();
    expect(input.storage.refreshUnknown).not.toHaveBeenCalled();
    expect(input.createCustomer).not.toHaveBeenCalled();
    expect(input.storage.recordOwnershipHold).not.toHaveBeenCalled();
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
  });

  it('keeps the conflict, with no refresh or create, when the lookup throws', async () => {
    const input = conflictedFixture();
    input.findCustomers.mockRejectedValue(new Error('provider down'));
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'conflict',
    });
    expect(input.storage.refreshUnknown).not.toHaveBeenCalled();
    expect(input.createCustomer).not.toHaveBeenCalled();
  });

  it('reports storage unavailable, with no create, when the refresh cannot be written', async () => {
    const input = conflictedFixture();
    input.findCustomers.mockResolvedValue(customerListing([]));
    input.storage.refreshUnknown.mockRejectedValue(new Error('storage down'));
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(input.createCustomer).not.toHaveBeenCalled();
  });

  it.each([
    ['pending', { status: 'pending' }],
    ['ready', { status: 'ready' }],
  ])('never looks up or refreshes when the claim is %s', async (_label, answer) => {
    const input = onboardingFixture();
    input.storage.claim.mockResolvedValue(answer);
    await onboardPiggyvestPrimaryWallet(input);
    expect(input.findCustomers).not.toHaveBeenCalled();
    expect(input.storage.refreshUnknown).not.toHaveBeenCalled();
  });

  it('never adopts an existing customer on a post-refresh reclaimed retry', async () => {
    const input = onboardingFixture();
    input.storage.claim.mockResolvedValue({
      status: 'claimed',
      intentId: 'intent-fixture',
      claimToken: 'claim-fixture',
      reclaimed: true,
      identityRefreshed: true,
    });
    input.findCustomers.mockResolvedValue(
      customerListing(['customer-fixture'])
    );
    input.createCustomer.mockResolvedValue({
      customer_id: 'customer-fixture',
      wallet_id: 'wallet-fixture',
      new_customer: false,
    });

    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'conflict',
      code: 'OWNERSHIP_REVIEW_REQUIRED',
    });
    // bugfix (Codex P1): the existing customer's ids are kept for review and
    // DVA closure, never an id-less rejection.
    expect(input.storage.recordReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        providerCustomerId: 'customer-fixture',
        providerWalletId: 'wallet-fixture',
      })
    );
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
  });

  it('keeps custody on a not-sent error during a post-refresh reclaimed retry', async () => {
    const { PiggyvestApiError } = await import('./client');
    const input = onboardingFixture();
    input.storage.claim.mockResolvedValue({
      status: 'claimed',
      intentId: 'intent-fixture',
      claimToken: 'claim-fixture',
      reclaimed: true,
      identityRefreshed: true,
    });
    input.findCustomers.mockResolvedValue(customerListing([]));
    input.createCustomer.mockRejectedValue(
      new PiggyvestApiError('PIGGYVEST_AUTH_ERROR', 'unauthorized', 401)
    );

    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(input.storage.recordUncertain).toHaveBeenCalledOnce();
    expect(input.storage.releaseIntent).not.toHaveBeenCalled();
  });

  it('keeps custody on a not-sent error during the initial refresh', async () => {
    const { PiggyvestApiError } = await import('./client');
    const input = conflictedFixture();
    input.findCustomers.mockResolvedValue(customerListing([]));
    input.createCustomer.mockRejectedValue(
      new PiggyvestApiError('PIGGYVEST_AUTH_ERROR', 'unauthorized', 401)
    );

    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(input.storage.recordUncertain).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        intentId: 'refreshed-intent',
        claimToken: 'refreshed-claim',
      })
    );
    expect(input.storage.releaseIntent).not.toHaveBeenCalled();
  });

  it('keeps custody on an interest-routing decline during the initial refresh', async () => {
    const { PiggyvestApiError } = await import('./client');
    const input = conflictedFixture();
    input.findCustomers.mockResolvedValue(customerListing([]));
    input.createCustomer.mockRejectedValue(
      new PiggyvestApiError(
        'PIGGYVEST_REQUEST_ERROR',
        'Invalid interest_payout_wallet',
        400,
        true
      )
    );

    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'NOT_CONFIGURED',
    });
    expect(input.storage.recordUncertain).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        intentId: 'refreshed-intent',
        claimToken: 'refreshed-claim',
      })
    );
    expect(input.storage.releaseIntent).not.toHaveBeenCalled();
  });

  it('bugfix (Codex P1): holds a BVN decline during an identity-refreshed attempt for ownership review', async () => {
    const { PiggyvestApiError } = await import('./client');
    const input = conflictedFixture();
    input.findCustomers.mockResolvedValue(customerListing([]));
    input.createCustomer.mockRejectedValue(
      new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'Invalid BVN', 400, true)
    );

    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'conflict',
      code: 'OWNERSHIP_REVIEW_REQUIRED',
    });
    expect(input.storage.recordUncertain).not.toHaveBeenCalled();
    expect(input.storage.recordOwnershipHold).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        intentId: 'refreshed-intent',
        claimToken: 'refreshed-claim',
      })
    );
    expect(input.storage.releaseIntent).not.toHaveBeenCalled();
  });
});
