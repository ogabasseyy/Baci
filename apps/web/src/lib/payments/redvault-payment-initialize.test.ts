import { describe, expect, it, vi } from 'vitest';
import { initializeRedvaultCheckout } from './redvault-payment-initialize';

const createdAttempt = {
  amountKobo: 95000,
  authorizationUrl: null,
  bankCode: '033',
  id: 'attempt-1',
  reference: 'RV-reference-1',
  state: 'created' as const,
};

describe('initializeRedvaultCheckout', () => {
  it('uses only the reserved amount and durably records the hosted URL', async () => {
    const attemptAdapter = {
      claimInitialization: vi.fn().mockResolvedValue({
        attempt: { ...createdAttempt, state: 'initializing' },
        claimed: true,
      }),
      markIndeterminate: vi.fn(),
      markInitialized: vi.fn().mockResolvedValue({
        ...createdAttempt,
        authorizationUrl: 'https://paystack.test/checkout/reused',
        state: 'initialized',
      }),
      reserve: vi.fn().mockResolvedValue(createdAttempt),
    };
    const provider = {
      initialize: vi.fn().mockResolvedValue({
        authorizationUrl: 'https://paystack.test/checkout/provider',
      }),
    };

    const result = await initializeRedvaultCheckout({
      attemptAdapter,
      customerEmail: 'customer@example.test',
      orderId: 'order-1',
      provider,
      redirectUrl: 'https://shop.example.test/checkout/success',
    });

    expect(result).toEqual({
      authorizationUrl: 'https://paystack.test/checkout/reused',
      reference: 'RV-reference-1',
      status: 'initialized',
    });
    expect(provider.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        amountKobo: 95000,
        authorizationMetadata: {
          custom_filters: {
            banks: ['033'],
            card_brands: ['verve', 'visa', 'mastercard'],
          },
          partnership: 'uba_redvault',
        },
        reference: 'RV-reference-1',
      })
    );
    expect(attemptAdapter.markInitialized).toHaveBeenCalledWith(
      'attempt-1',
      'https://paystack.test/checkout/provider'
    );
  });

  it('reuses a persisted initialized URL without another provider call', async () => {
    const attemptAdapter = {
      claimInitialization: vi.fn(),
      markIndeterminate: vi.fn(),
      markInitialized: vi.fn(),
      reserve: vi.fn().mockResolvedValue({
        ...createdAttempt,
        authorizationUrl: 'https://paystack.test/checkout/existing',
        state: 'initialized',
      }),
    };
    const provider = { initialize: vi.fn() };

    await expect(
      initializeRedvaultCheckout({
        attemptAdapter,
        customerEmail: 'customer@example.test',
        orderId: 'order-1',
        provider,
        redirectUrl: 'https://shop.example.test/checkout/success',
      })
    ).resolves.toEqual({
      authorizationUrl: 'https://paystack.test/checkout/existing',
      reference: 'RV-reference-1',
      status: 'initialized',
    });
    expect(provider.initialize).not.toHaveBeenCalled();
  });

  it('holds response-loss retries for reconciliation instead of initializing twice', async () => {
    const attemptAdapter = {
      claimInitialization: vi.fn().mockResolvedValue({
        attempt: { ...createdAttempt, state: 'initializing' },
        claimed: true,
      }),
      markIndeterminate: vi.fn().mockResolvedValue(undefined),
      markInitialized: vi.fn().mockRejectedValue(new Error('connection lost')),
      reserve: vi
        .fn()
        .mockResolvedValueOnce(createdAttempt)
        .mockResolvedValueOnce({ ...createdAttempt, state: 'indeterminate' }),
    };
    const provider = {
      initialize: vi.fn().mockResolvedValue({
        authorizationUrl: 'https://paystack.test/checkout/provider',
      }),
    };
    const input = {
      attemptAdapter,
      customerEmail: 'customer@example.test',
      orderId: 'order-1',
      provider,
      redirectUrl: 'https://shop.example.test/checkout/success',
    };

    await expect(initializeRedvaultCheckout(input)).resolves.toEqual({
      authorizationUrl: null,
      status: 'pending_reconciliation',
    });
    await expect(initializeRedvaultCheckout(input)).resolves.toEqual({
      authorizationUrl: null,
      status: 'pending_reconciliation',
    });
    expect(attemptAdapter.markIndeterminate).toHaveBeenCalledWith('attempt-1');
    expect(provider.initialize).toHaveBeenCalledTimes(1);
  });

  it('returns reconciliation-required to a concurrent caller that did not win the initialization claim', async () => {
    const attemptAdapter = {
      claimInitialization: vi.fn().mockResolvedValue({
        attempt: { ...createdAttempt, state: 'initializing' },
        claimed: false,
      }),
      markIndeterminate: vi.fn(),
      markInitialized: vi.fn(),
      reserve: vi.fn().mockResolvedValue(createdAttempt),
    };
    const provider = { initialize: vi.fn() };

    await expect(
      initializeRedvaultCheckout({
        attemptAdapter,
        customerEmail: 'customer@example.test',
        orderId: 'order-1',
        provider,
        redirectUrl: 'https://shop.example.test/checkout/success',
      })
    ).resolves.toEqual({
      authorizationUrl: null,
      status: 'pending_reconciliation',
    });
    expect(provider.initialize).not.toHaveBeenCalled();
  });
});
