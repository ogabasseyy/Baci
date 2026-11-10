import { describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { onboardPiggyvestPrimaryWallet } from './primary-wallet-onboarding';
import {
  customerListing,
  onboardingFixture,
} from './primary-wallet-onboarding.test-fixture';

vi.mock('server-only', () => ({}));
vi.mock('./webhook-alerts', () => ({
  emitPiggyvestWebhookAlert: vi.fn(),
}));

describe('bugfix: a rejected live credential no longer parks setup as endless "pending"', () => {
  it.each([
    401, 403,
  ])('releases a fresh intent and reports unavailable when PiggyVest answers %s', async (status) => {
    const input = onboardingFixture();
    input.createCustomer.mockRejectedValue(
      new PiggyvestApiError(
        'PIGGYVEST_AUTH_ERROR',
        'PiggyVest rejected the API credentials',
        status
      )
    );
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(input.storage.releaseIntent).toHaveBeenCalledOnce();
    expect(input.storage.recordUncertain).not.toHaveBeenCalled();
    // Diagnostics name the failure without any request data.
    expect(errorLog).toHaveBeenCalledWith(
      `[PiggyVest][primary-onboarding] create not sent: PIGGYVEST_AUTH_ERROR status=${status}`
    );
    errorLog.mockRestore();
  });

  it('treats a relay refusal (nothing sent) the same way', async () => {
    const input = onboardingFixture();
    input.createCustomer.mockRejectedValue(
      new PiggyvestApiError(
        'PIGGYVEST_RELAY_UNAVAILABLE',
        'PiggyVest relay is unavailable'
      )
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(input.storage.releaseIntent).toHaveBeenCalledOnce();
  });

  it('reports a missing API token as not configured, not a PiggyVest outage', async () => {
    const input = onboardingFixture();
    input.createCustomer.mockRejectedValue(
      new PiggyvestApiError('PIGGYVEST_AUTH_ERROR', 'missing token')
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'NOT_CONFIGURED',
    });
    expect(input.storage.releaseIntent).toHaveBeenCalledOnce();
  });

  it('reports storage unavailable when the intent cannot be released', async () => {
    const input = onboardingFixture();
    input.storage.releaseIntent.mockResolvedValue(false);
    input.createCustomer.mockRejectedValue(
      new PiggyvestApiError('PIGGYVEST_AUTH_ERROR', 'rejected', 401)
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'STORAGE_UNAVAILABLE',
    });
  });

  it('keeps a reclaimed intent reclaimable, since an earlier attempt may have created the customer', async () => {
    const input = onboardingFixture();
    input.storage.claim.mockResolvedValue({
      status: 'claimed',
      intentId: 'intent',
      claimToken: 'claim',
      reclaimed: true,
    });
    input.findCustomers.mockResolvedValue(customerListing([]));
    input.createCustomer.mockRejectedValue(
      new PiggyvestApiError('PIGGYVEST_AUTH_ERROR', 'rejected', 401)
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(input.storage.recordUncertain).toHaveBeenCalledOnce();
    expect(input.storage.releaseIntent).not.toHaveBeenCalled();
  });

  it('does not release the intent when a matching error comes after the customer was created', async () => {
    const input = onboardingFixture();
    input.storage.recordAccepted.mockRejectedValue(
      new PiggyvestApiError('PIGGYVEST_AUTH_ERROR', 'late failure', 401)
    );

    const outcome = await onboardPiggyvestPrimaryWallet(input);

    expect(outcome).not.toEqual({
      status: 'unavailable',
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(input.storage.releaseIntent).not.toHaveBeenCalled();
  });

  it('still keeps a timeout ambiguous (pending), since the customer may exist', async () => {
    const input = onboardingFixture();
    input.createCustomer.mockRejectedValue(
      new PiggyvestApiError('PIGGYVEST_NETWORK_ERROR', 'timed out')
    );

    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.storage.recordUncertain).toHaveBeenCalledOnce();
    expect(input.storage.releaseIntent).not.toHaveBeenCalled();
  });
});
