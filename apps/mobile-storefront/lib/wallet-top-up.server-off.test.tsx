import { describe, expect, it } from '@jest/globals';
import {
  mockFetchWithTimeout,
  mockGetSession,
  mockGetUser,
} from '@/lib/wallet-top-up.test-utils';

const { initializeWalletTopUp } =
  require('@/lib/wallet-top-up') as typeof import('@/lib/wallet-top-up');

// The legacy (store credit) top-up: unchanged with PiggyVest off. The
// account check only rejects a mismatch, never a matching account.
describe('initializeWalletTopUp with the server keeping PiggyVest off', () => {
  it('starts the top-up for the account that began it', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        authorization_url: 'https://checkout.example.com/pay',
        checkout_url: 'https://checkout.example.com/pay',
        gateway: 'paystack',
        reference: 'WALLET-123',
        success: true,
      }),
    });

    await expect(
      initializeWalletTopUp({ amount: 2500, expectedUserId: 'user-1' })
    ).resolves.toMatchObject({ reference: 'WALLET-123' });
  });
});

describe('bugfix: account switch while the top-up acquired credentials', () => {
  it('aborts before creating a checkout when another account is signed in', async () => {
    // Arrange: the flow started for user-1; user-2 is now signed in.
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-2' } },
      error: null,
    });

    // Act + Assert
    await expect(
      initializeWalletTopUp({ amount: 2500, expectedUserId: 'user-1' })
    ).rejects.toThrow('You switched accounts');
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it('aborts when the session switched after the user read', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'token', user: { id: 'user-2' } } },
      error: null,
    });

    await expect(
      initializeWalletTopUp({ amount: 2500, expectedUserId: 'user-1' })
    ).rejects.toThrow('You switched accounts');
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });
});
