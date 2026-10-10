import { describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { onboardPiggyvestPrimaryWallet } from './primary-wallet-onboarding';

vi.mock('server-only', () => ({}));

function fixture() {
  return {
    configuration: {
      environment: 'production',
      merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
      businessId: 'business-fixture',
      businessBindingVerified: true,
      fingerprintKey: 'test-only-fingerprint-key-not-a-real-secret',
    },
    verifiedIdentity: {
      merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      customerId: 'e648eb14-928a-427b-9719-b105f6d4b8b4',
      userId: 'f4f01e61-691f-494a-a895-872f17f8e55e',
      email: 'TEST@example.com',
      emailVerified: true,
      name: 'Test Customer',
      phone: '08000000000',
    },
    request: { consent: true, bvn: '00000000000' },
    storage: {
      claim: vi.fn().mockResolvedValue({
        status: 'claimed',
        intentId: 'intent',
        claimToken: 'claim',
      }),
      recordAccepted: vi.fn().mockResolvedValue(true),
      recordUncertain: vi.fn().mockResolvedValue(undefined),
      recordRejected: vi.fn().mockResolvedValue(undefined),
      releaseIntent: vi.fn().mockResolvedValue(true),
    },
    createCustomer: vi.fn().mockResolvedValue({
      customer_id: 'customer-fixture',
      wallet_id: 'wallet-fixture',
      new_customer: true,
    }),
  };
}

describe('primary wallet onboarding', () => {
  it('rejects missing consent before storage or provider contact', async () => {
    const input = fixture();
    input.request.consent = false;
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'INVALID_INPUT',
    });
    expect(input.storage.claim).not.toHaveBeenCalled();
    expect(input.createCustomer).not.toHaveBeenCalled();
  });

  it('rejects a merchant binding mismatch before claiming', async () => {
    const input = fixture();
    input.configuration.merchantId = '00000000-0000-4000-8000-000000000001';
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'NOT_CONFIGURED',
    });
    expect(input.storage.claim).not.toHaveBeenCalled();
  });

  it.each([
    'pending',
    'ready',
    'conflict',
  ])('does not repeat creation for an existing %s intent', async (status) => {
    const input = fixture();
    input.storage.claim.mockResolvedValue({ status });
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({ status });
    expect(input.createCustomer).not.toHaveBeenCalled();
  });

  it('does not create an account when durable claiming fails', async () => {
    const input = fixture();
    input.storage.claim.mockRejectedValue(new Error('private database detail'));
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(input.createCustomer).not.toHaveBeenCalled();
  });

  it('persists only a fingerprint and provider identifiers, never raw BVN', async () => {
    const input = fixture();
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        bvn: '00000000000',
        email: 'test@example.com',
        enable_interest_accrual: false,
      })
    );
    const persisted = JSON.stringify([
      input.storage.claim.mock.calls,
      input.storage.recordAccepted.mock.calls,
    ]);
    expect(persisted).not.toContain('00000000000');
    expect(input.storage.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    );
    expect(input.storage.recordAccepted).toHaveBeenCalledWith(
      expect.objectContaining({
        providerCustomerId: 'customer-fixture',
        providerWalletId: 'wallet-fixture',
      })
    );
  });

  it('never binds an existing provider customer merely because identifiers matched', async () => {
    const input = fixture();
    input.createCustomer.mockResolvedValue({
      customer_id: 'customer-fixture',
      wallet_id: 'wallet-fixture',
      new_customer: false,
    });
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'conflict',
      code: 'OWNERSHIP_REVIEW_REQUIRED',
    });
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
    expect(input.storage.recordUncertain).not.toHaveBeenCalled();
    expect(input.storage.recordRejected).toHaveBeenCalledOnce();
  });

  it('keeps an explicitly rejected intent in conflict on retry without provider contact', async () => {
    const input = fixture();
    input.storage.claim.mockResolvedValue({ status: 'conflict' });
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'conflict',
    });
    expect(input.createCustomer).not.toHaveBeenCalled();
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
    expect(input.storage.recordUncertain).not.toHaveBeenCalled();
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
  });

  it('adopts the existing provider customer when retrying a reclaimed uncertain intent', async () => {
    const input = fixture();
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
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.storage.recordAccepted).toHaveBeenCalledWith(
      expect.objectContaining({
        providerCustomerId: 'customer-fixture',
        providerWalletId: 'wallet-fixture',
      })
    );
    expect(input.storage.recordUncertain).not.toHaveBeenCalled();
  });

  it('marks an ambiguous provider timeout without retrying creation', async () => {
    const input = fixture();
    input.createCustomer.mockRejectedValue(
      new Error('private provider response')
    );
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.createCustomer).toHaveBeenCalledOnce();
    expect(input.storage.recordUncertain).toHaveBeenCalledOnce();
    expect(input.storage.recordAccepted).not.toHaveBeenCalled();
  });

  it('releases the uncreated intent on a definitive provider BVN rejection so the value can be corrected', async () => {
    const input = fixture();
    input.createCustomer.mockRejectedValue(
      new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'Invalid BVN', 400)
    );
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'rejected',
      code: 'INVALID_BVN',
    });
    expect(input.storage.releaseIntent).toHaveBeenCalledOnce();
    expect(input.storage.recordUncertain).not.toHaveBeenCalled();
    expect(input.storage.recordRejected).not.toHaveBeenCalled();
  });
  it('keeps non-400 provider failures transport-ambiguous', async () => {
    const input = fixture();
    input.createCustomer.mockRejectedValue(
      new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'Provider exploded', 500)
    );
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'pending',
    });
    expect(input.storage.recordUncertain).toHaveBeenCalledOnce();
    expect(input.storage.releaseIntent).not.toHaveBeenCalled();
  });
  it('does not claim readiness when accepted identifiers cannot be stored', async () => {
    const input = fixture();
    input.storage.recordAccepted.mockResolvedValue(false);
    expect(await onboardPiggyvestPrimaryWallet(input)).toEqual({
      status: 'unavailable',
      code: 'STORAGE_UNAVAILABLE',
    });
  });
});
