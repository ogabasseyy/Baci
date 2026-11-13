import { describe, expect, it } from '@jest/globals';
import {
  mockFetchWithTimeout,
  mockGetSession,
  mockGetUser,
} from '@/lib/wallet-top-up.test-utils';

const { initializeWalletTopUp } =
  require('@/lib/wallet-top-up') as typeof import('@/lib/wallet-top-up');

function getLastInitializeRequestBody() {
  const [, requestOptions] = mockFetchWithTimeout.mock.calls[0];
  if (
    typeof requestOptions !== 'object' ||
    requestOptions === null ||
    !('body' in requestOptions)
  ) {
    throw new Error('Expected wallet top-up initialize request body');
  }

  return JSON.parse(String(requestOptions.body)) as Record<string, unknown>;
}

describe('initializeWalletTopUp', () => {
  it('initializes a wallet top-up and returns checkout details', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        authorization_url: 'https://checkout.example.com/pay',
        checkout_url: 'https://checkout.example.com/pay',
        gateway: 'paystack',
        reference: 'WALLET-123',
        success: true,
      }),
    });

    await expect(
      initializeWalletTopUp({
        amount: 2500,
        customerName: 'Test Customer',
        customerPhone: '08012345678',
        gateway: 'paystack',
      })
    ).resolves.toEqual({
      authorization_url: 'https://checkout.example.com/pay',
      checkout_url: 'https://checkout.example.com/pay',
      gateway: 'paystack',
      reference: 'WALLET-123',
      success: true,
    });
  });

  it('throws the server error message when initialize returns a non-OK response', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({
        error: 'Amount must be at least NGN 100.',
      }),
    });

    await expect(
      initializeWalletTopUp({
        amount: 50,
        customerName: 'Test Customer',
        customerPhone: '08012345678',
        gateway: 'paystack',
      })
    ).rejects.toThrow('Amount must be at least NGN 100.');

    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      'https://usebaci.com/api/storefront/customer/wallet/top-up/initialize',
      expect.objectContaining({
        body: expect.any(String),
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
        method: 'POST',
      })
    );
    const requestBody = getLastInitializeRequestBody();
    expect(requestBody).toEqual({
      amount: 50,
      customerName: 'Test Customer',
      customerPhone: '08012345678',
      gateway: 'paystack',
      merchantSlug: 'demo-store',
    });
  });

  it('omits null optional profile fields from the initialize payload', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        authorization_url: 'https://checkout.example.com/pay',
        checkout_url: 'https://checkout.example.com/pay',
        gateway: 'paystack',
        reference: 'WALLET-123',
        success: true,
      }),
    });

    await initializeWalletTopUp({
      amount: 2500,
      customerName: '   ',
      customerPhone: null,
      gateway: 'paystack',
    });

    const requestBody = getLastInitializeRequestBody();
    expect(requestBody).toEqual({
      amount: 2500,
      gateway: 'paystack',
      merchantSlug: 'demo-store',
    });
  });

  it('forwards the interrupted-purchase returnTo for the credit push deep link', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        authorization_url: 'https://checkout.example.com/pay',
        checkout_url: 'https://checkout.example.com/pay',
        gateway: 'paystack',
        reference: 'WALLET-123',
        success: true,
      }),
    });

    await initializeWalletTopUp({
      amount: 2500,
      gateway: 'paystack',
      returnTo: '/utilities/airtime?repeatAmount=500',
    });

    const requestBody = getLastInitializeRequestBody();
    expect(requestBody).toEqual({
      amount: 2500,
      gateway: 'paystack',
      merchantSlug: 'demo-store',
      returnTo: '/utilities/airtime?repeatAmount=500',
    });
  });

  it('includes the resolved merchant id and build-time slug fallback', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        authorization_url: 'https://checkout.example.com/pay',
        gateway: 'paystack',
        reference: 'WALLET-123',
        success: true,
      }),
    });

    await initializeWalletTopUp({
      amount: 2500,
      customerName: 'Test Customer',
      customerPhone: '08012345678',
      gateway: 'paystack',
      merchantId: 'merchant-1',
    });

    const requestBody = getLastInitializeRequestBody();
    expect(requestBody).toMatchObject({
      amount: 2500,
      merchantId: 'merchant-1',
      merchantSlug: 'demo-store',
    });
  });

  it('preserves an explicit merchant slug when merchant id is also supplied', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        authorization_url: 'https://checkout.example.com/pay',
        gateway: 'paystack',
        reference: 'WALLET-123',
        success: true,
      }),
    });

    await initializeWalletTopUp({
      amount: 2500,
      gateway: 'paystack',
      merchantId: 'merchant-1',
      merchantSlug: 'explicit-store',
    });

    const requestBody = getLastInitializeRequestBody();
    expect(requestBody).toMatchObject({
      amount: 2500,
      merchantId: 'merchant-1',
      merchantSlug: 'explicit-store',
    });
  });

  it('throws before initializing when the authenticated user is missing', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    await expect(
      initializeWalletTopUp({
        amount: 2500,
        customerName: 'Test Customer',
        customerPhone: '08012345678',
        gateway: 'paystack',
      })
    ).rejects.toThrow('Authentication required. Please sign in again.');
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it('throws before initializing when auth lookup fails', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error('auth failed'),
    });

    await expect(
      initializeWalletTopUp({
        amount: 2500,
        customerName: 'Test Customer',
        customerPhone: '08012345678',
        gateway: 'paystack',
      })
    ).rejects.toThrow('Authentication required. Please sign in again.');
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it('bubbles network errors from wallet top-up initialization', async () => {
    mockFetchWithTimeout.mockRejectedValue(new Error('network failed'));

    await expect(
      initializeWalletTopUp({
        amount: 2500,
        customerName: 'Test Customer',
        customerPhone: '08012345678',
        gateway: 'paystack',
      })
    ).rejects.toThrow('network failed');
  });

  it('throws when the auth session is unavailable', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(
      initializeWalletTopUp({
        amount: 2500,
        customerName: 'Test Customer',
        customerPhone: '08012345678',
        gateway: 'paystack',
      })
    ).rejects.toThrow('Authentication required. Please sign in again.');
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });
});
