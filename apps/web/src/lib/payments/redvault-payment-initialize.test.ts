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

const freshAttempt = {
  ...createdAttempt,
  id: 'attempt-2',
  reference: 'RV-reference-2',
};

const giglAttempt = {
  ...createdAttempt,
  platformFeeKobo: 1900,
  splitRetainedShippingKobo: 20000,
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
      reconcileInitialization: vi.fn(),
      reserve: vi.fn().mockResolvedValue(createdAttempt),
    };
    const provider = createProvider();

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
        paystackSubaccount: 'ACCT_reserved',
        platformFeeKobo: 1900,
        reference: 'RV-reference-1',
      })
    );
    expect(attemptAdapter.markInitialized).toHaveBeenCalledWith(
      'attempt-1',
      'https://paystack.test/checkout/provider'
    );
    expect(provider.probeInitialization).not.toHaveBeenCalled();
    expect(attemptAdapter.reconcileInitialization).not.toHaveBeenCalled();
  });

  it('passes the frozen GIGL retention to the provider split', async () => {
    const attemptAdapter = {
      claimInitialization: vi.fn().mockResolvedValue({
        attempt: { ...giglAttempt, state: 'initializing' },
        claimed: true,
      }),
      markIndeterminate: vi.fn(),
      markInitialized: vi.fn().mockResolvedValue({
        ...giglAttempt,
        authorizationUrl: 'https://paystack.test/checkout/gigl',
        state: 'initialized',
      }),
      reconcileInitialization: vi.fn(),
      reserve: vi.fn().mockResolvedValue(giglAttempt),
    };
    const provider = createProvider();

    await initializeRedvaultCheckout({
      attemptAdapter,
      customerEmail: 'customer@example.test',
      orderId: 'order-1',
      provider,
      redirectUrl: 'https://shop.example.test/checkout/success',
    });

    expect(provider.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        platformFeeKobo: 1900,
        retainedShippingKobo: 20000,
      })
    );
  });

  it('reuses a persisted initialized URL without another provider call', async () => {
    const attemptAdapter = {
      claimInitialization: vi.fn(),
      markIndeterminate: vi.fn(),
      markInitialized: vi.fn(),
      reconcileInitialization: vi.fn(),
      reserve: vi.fn().mockResolvedValue({
        ...createdAttempt,
        authorizationUrl: 'https://paystack.test/checkout/existing',
        state: 'initialized',
      }),
    };
    const provider = createProvider({}, vi.fn());

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
      reconcileInitialization: vi.fn(),
      reserve: vi
        .fn()
        .mockResolvedValueOnce(createdAttempt)
        .mockResolvedValueOnce({ ...createdAttempt, state: 'indeterminate' }),
    };
    const provider = createProvider();
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
      reconcileInitialization: vi.fn(),
      reserve: vi.fn().mockResolvedValue(createdAttempt),
    };
    const provider = createProvider({}, vi.fn());

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

  it('reinitializes a reclaimed lease only after the provider confirms the reference is missing', async () => {
    const attemptAdapter = {
      claimInitialization: vi.fn().mockResolvedValue({
        attempt: staleAttempt,
        claimed: true,
      }),
      markIndeterminate: vi.fn(),
      markInitialized: vi.fn().mockResolvedValue({
        ...staleAttempt,
        authorizationUrl: 'https://paystack.test/checkout/reissued',
        state: 'initialized',
      }),
      reconcileInitialization: vi.fn(),
      reserve: vi.fn().mockResolvedValue(staleAttempt),
    };
    const provider = createProvider({
      probeInitialization: vi.fn().mockResolvedValue({ status: 'not_found' }),
    });

    await expect(
      initializeRedvaultCheckout({
        attemptAdapter,
        customerEmail: 'customer@example.test',
        orderId: 'order-1',
        provider,
        redirectUrl: 'https://shop.example.test/checkout/success',
      })
    ).resolves.toEqual({
      authorizationUrl: 'https://paystack.test/checkout/reissued',
      reference: 'RV-reference-1',
      status: 'initialized',
    });
    expect(provider.probeInitialization).toHaveBeenCalledWith({
      reference: 'RV-reference-1',
    });
    expect(provider.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'RV-reference-1' })
    );
    expect(attemptAdapter.reconcileInitialization).not.toHaveBeenCalled();
  });

  it('parks a reclaimed lease paid at the provider instead of reissuing it', async () => {
    const attemptAdapter = {
      claimInitialization: vi.fn().mockResolvedValue({
        attempt: staleAttempt,
        claimed: true,
      }),
      markIndeterminate: vi.fn(),
      markInitialized: vi.fn(),
      reconcileInitialization: vi.fn().mockResolvedValue(undefined),
      reserve: vi.fn().mockResolvedValue(staleAttempt),
    };
    const provider = createProvider(
      {
        probeInitialization: vi.fn().mockResolvedValue({ status: 'paid' }),
      },
      vi.fn()
    );

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
    expect(attemptAdapter.reconcileInitialization).toHaveBeenCalledWith(
      'attempt-1',
      'indeterminate'
    );
    expect(provider.initialize).not.toHaveBeenCalled();
    expect(attemptAdapter.markInitialized).not.toHaveBeenCalled();
  });

  it('voids an unpaid provider transaction and initializes a replacement reference', async () => {
    const attemptAdapter = {
      claimInitialization: vi
        .fn()
        .mockResolvedValueOnce({ attempt: staleAttempt, claimed: true })
        .mockResolvedValueOnce({
          attempt: { ...freshAttempt, state: 'initializing' },
          claimed: true,
        }),
      markIndeterminate: vi.fn(),
      markInitialized: vi.fn().mockResolvedValue({
        ...freshAttempt,
        authorizationUrl: 'https://paystack.test/checkout/fresh',
        state: 'initialized',
      }),
      reconcileInitialization: vi.fn().mockResolvedValue(undefined),
      reserve: vi
        .fn()
        .mockResolvedValueOnce(staleAttempt)
        .mockResolvedValueOnce(freshAttempt),
    };
    const provider = createProvider({
      probeInitialization: vi.fn().mockResolvedValue({ status: 'unpaid' }),
    });

    await expect(
      initializeRedvaultCheckout({
        attemptAdapter,
        customerEmail: 'customer@example.test',
        orderId: 'order-1',
        provider,
        redirectUrl: 'https://shop.example.test/checkout/success',
      })
    ).resolves.toEqual({
      authorizationUrl: 'https://paystack.test/checkout/fresh',
      reference: 'RV-reference-2',
      status: 'initialized',
    });
    expect(attemptAdapter.reconcileInitialization).toHaveBeenCalledWith(
      'attempt-1',
      'void'
    );
    expect(provider.initialize).toHaveBeenCalledTimes(1);
    expect(provider.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'RV-reference-2' })
    );
    expect(attemptAdapter.markInitialized).toHaveBeenCalledWith(
      'attempt-2',
      'https://paystack.test/checkout/provider'
    );
  });

  it('holds a reclaimed lease for reconciliation when the provider probe is ambiguous', async () => {
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
    const provider = createProvider(
      {
        probeInitialization: vi.fn().mockResolvedValue({ status: 'unknown' }),
      },
      vi.fn()
    );

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
    expect(attemptAdapter.reconcileInitialization).not.toHaveBeenCalled();
    expect(attemptAdapter.markIndeterminate).not.toHaveBeenCalled();
  });
});
