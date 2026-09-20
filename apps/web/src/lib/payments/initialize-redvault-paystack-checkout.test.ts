import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAttemptClient: vi.fn(),
  initializeCheckout: vi.fn(),
  initializeTransaction: vi.fn(),
  verifyTransaction: vi.fn(),
}));

vi.mock('./redvault-payment-attempt-client', () => ({
  createRedvaultPaymentAttemptClient: mocks.createAttemptClient,
}));
vi.mock('./redvault-payment-initialize', () => ({
  initializeRedvaultCheckout: mocks.initializeCheckout,
}));
vi.mock('../paystack', () => ({
  initializeTransaction: mocks.initializeTransaction,
  verifyTransaction: mocks.verifyTransaction,
}));

import { initializeRedvaultPaystackCheckout } from './initialize-redvault-paystack-checkout';

describe('initializeRedvaultPaystackCheckout', () => {
  it('passes only the reserved checkout provider values to Paystack', async () => {
    const attemptAdapter = { reserve: vi.fn() };
    mocks.createAttemptClient.mockReturnValue(attemptAdapter);
    mocks.initializeCheckout.mockImplementation(async ({ provider }) => {
      const initialized = await provider.initialize({
        amountKobo: 500000,
        authorizationMetadata: {
          custom_filters: {
            banks: ['033'],
            card_brands: ['verve', 'visa', 'mastercard'],
          },
          partnership: 'uba_redvault',
        },
        customerEmail: 'customer@example.test',
        orderId: 'order-1',
        paystackSubaccount: 'ACCT_reserved',
        platformFeeKobo: 10000,
        redirectUrl: 'https://shop.example.test/checkout/success',
        reference: 'RV-attempt-1',
      });
      return initialized;
    });
    mocks.initializeTransaction.mockResolvedValue({
      authorization_url: 'https://paystack.test/checkout/1',
    });

    await expect(
      initializeRedvaultPaystackCheckout({
        customerEmail: 'customer@example.test',
        fallbackClient: { rpc: vi.fn() } as never,
        merchantId: 'merchant-1',
        orderId: 'order-1',
        redirectUrl: 'https://shop.example.test/checkout/success',
        serviceClient: { rpc: vi.fn() } as never,
        userId: null,
      })
    ).resolves.toEqual({
      authorizationUrl: 'https://paystack.test/checkout/1',
    });
    expect(mocks.createAttemptClient).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'merchant-1', userId: null })
    );
    expect(mocks.initializeTransaction).toHaveBeenCalledWith({
      amount: 500000,
      callback_url: 'https://shop.example.test/checkout/success',
      channels: ['card'],
      email: 'customer@example.test',
      metadata: {
        custom_filters: {
          banks: ['033'],
          card_brands: ['verve', 'visa', 'mastercard'],
        },
        merchant_id: 'merchant-1',
        order_id: 'order-1',
        partnership: 'uba_redvault',
        platform_fee_kobo: 10000,
      },
      reference: 'RV-attempt-1',
      subaccount: 'ACCT_reserved',
      transaction_charge: 10000,
      bearer: 'account',
    });
  });

  it.each([
    {
      name: 'missing provider transaction',
      verification: { success: false, error: 'not found', code: 'HTTP_404' },
      expected: { status: 'not_found' },
    },
    {
      name: 'paid provider transaction',
      verification: { success: true, data: { status: 'success' } },
      expected: { status: 'paid' },
    },
    {
      name: 'unpaid provider transaction',
      verification: { success: true, data: { status: 'pending' } },
      expected: { status: 'unpaid' },
    },
    {
      name: 'ambiguous provider failure',
      verification: { success: false, error: 'boom', code: 'NETWORK_ERROR' },
      expected: { status: 'unknown' },
    },
  ])('probes a stale claim as $expected.status for a $name', async ({
    verification,
    expected,
  }) => {
    mocks.createAttemptClient.mockReturnValue({ reserve: vi.fn() });
    mocks.verifyTransaction.mockResolvedValue(verification);
    mocks.initializeCheckout.mockImplementation(async ({ provider }) =>
      provider.probeInitialization({ reference: 'RV-attempt-1' })
    );

    await expect(
      initializeRedvaultPaystackCheckout({
        customerEmail: 'customer@example.test',
        fallbackClient: { rpc: vi.fn() } as never,
        merchantId: 'merchant-1',
        orderId: 'order-1',
        redirectUrl: 'https://shop.example.test/checkout/success',
        serviceClient: { rpc: vi.fn() } as never,
        userId: null,
      })
    ).resolves.toEqual(expected);
    expect(mocks.verifyTransaction).toHaveBeenCalledWith('RV-attempt-1');
  });
});
