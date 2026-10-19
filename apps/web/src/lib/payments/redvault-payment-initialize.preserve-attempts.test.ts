import { describe, expect, it, vi } from 'vitest';
import { initializeRedvaultCheckout } from './redvault-payment-initialize';

const createdAttempt = {
  amountKobo: 95000,
  authorizationUrl: null,
  bankCode: '033',
  id: 'attempt-1',
  paystackSubaccount: 'ACCT_reserved',
  platformFeeKobo: 1900,
  reference: 'RV-reference-1',
  splitRetainedShippingKobo: 0,
  state: 'created' as const,
};

const staleAttempt = { ...createdAttempt, state: 'initializing' as const };

const indeterminateAttempt = {
  ...createdAttempt,
  state: 'indeterminate' as const,
};

function createProvider(
  overrides: Record<string, unknown> = {},
  initialize = vi.fn().mockResolvedValue({
    authorizationUrl: 'https://paystack.test/checkout/provider',
  })
) {
  return {
    initialize,
    probeInitialization: vi.fn(),
    ...overrides,
  };
}

describe('initializeRedvaultCheckout preserveAttempts', () => {
  it('parks an indeterminate attempt without probing, voiding, or replacing it', async () => {
    const attemptAdapter = {
      claimInitialization: vi.fn(),
      markIndeterminate: vi.fn(),
      markInitialized: vi.fn(),
      reconcileInitialization: vi.fn(),
      reserve: vi.fn().mockResolvedValue(indeterminateAttempt),
    };
    const provider = createProvider(
      {
        probeInitialization: vi.fn(),
      },
      vi.fn()
    );

    await expect(
      initializeRedvaultCheckout({
        attemptAdapter,
        customerEmail: 'customer@example.test',
        orderId: 'order-1',
        preserveAttempts: true,
        provider,
        redirectUrl: 'https://shop.example.test/checkout/success',
      })
    ).resolves.toEqual({
      authorizationUrl: null,
      status: 'pending_reconciliation',
    });
    expect(attemptAdapter.reconcileInitialization).not.toHaveBeenCalled();
    expect(provider.probeInitialization).not.toHaveBeenCalled();
    expect(attemptAdapter.reserve).toHaveBeenCalledTimes(1);
    expect(provider.initialize).not.toHaveBeenCalled();
  });

  it('parks an initializing lease with an unrecoverable provider transaction instead of replacing it', async () => {
    const attemptAdapter = {
      claimInitialization: vi.fn().mockResolvedValue({
        attempt: staleAttempt,
        claimed: true,
      }),
      markIndeterminate: vi.fn(),
      markInitialized: vi.fn(),
      reconcileInitialization: vi.fn(),
      reserve: vi.fn().mockResolvedValue(staleAttempt),
    };
    const provider = createProvider({
      probeInitialization: vi.fn().mockResolvedValue({ status: 'unpaid' }),
    });

    await expect(
      initializeRedvaultCheckout({
        attemptAdapter,
        customerEmail: 'customer@example.test',
        orderId: 'order-1',
        preserveAttempts: true,
        provider,
        redirectUrl: 'https://shop.example.test/checkout/success',
      })
    ).resolves.toEqual({
      authorizationUrl: null,
      status: 'pending_reconciliation',
    });
    expect(attemptAdapter.reconcileInitialization).not.toHaveBeenCalled();
    expect(attemptAdapter.reserve).toHaveBeenCalledTimes(1);
    expect(provider.initialize).not.toHaveBeenCalled();
  });
});
