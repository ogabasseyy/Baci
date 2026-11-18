import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { initializeWalletTopUp } from '@/lib/wallet-top-up';
import { startLegacyWalletTopUp } from './start-legacy-wallet-top-up';

let mockSameUser = true;
jest.mock('./is-same-signed-in-user', () => ({
  isSameSignedInUser: () => mockSameUser,
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/wallet-top-up', () => ({ initializeWalletTopUp: jest.fn() }));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn() }),
}));
jest.mock('@/services/analytics', () => ({
  trackError: jest.fn(),
  trackEvent: jest.fn(),
}));

const params = {
  activeMerchantId: 'merchant-1',
  fundAmount: '1000',
  resetFundPanel: jest.fn(),
  setIsFundPending: jest.fn(),
  user: { id: 'user-a' },
  // Today's alert path (a non-PiggyVest store).
  notify: (
    _notice: { title: string; message?: string },
    legacy: { title: string; message?: string }
  ) => Alert.alert(legacy.title, legacy.message),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSameUser = true;
  jest.mocked(initializeWalletTopUp).mockResolvedValue({
    authorization_url: 'https://checkout.example.com/pay',
    checkout_url: 'https://checkout.example.com/pay',
    gateway: 'paystack',
    reference: 'WAL-1',
    success: true,
  } as never);
});

// The legacy card top-up is today's flow; PiggyVest off changes nothing.
describe('legacy top-up with the server keeping PiggyVest off', () => {
  it('opens the checkout for the account that started it', async () => {
    await startLegacyWalletTopUp(params);

    expect(initializeWalletTopUp).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000, expectedUserId: 'user-a' })
    );
    expect(router.push).toHaveBeenCalledTimes(1);
  });
});

describe('bugfix: account switch after the checkout was created', () => {
  it('never opens the old account checkout for a newly signed-in account', async () => {
    // Arrange: another account signs in while the request is in flight.
    jest.mocked(initializeWalletTopUp).mockImplementation(async () => {
      mockSameUser = false;
      return {
        authorization_url: 'https://checkout.example.com/pay',
        checkout_url: 'https://checkout.example.com/pay',
        gateway: 'paystack',
        reference: 'WAL-1',
        success: true,
      } as never;
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    // Act
    await startLegacyWalletTopUp(params);

    // Assert
    expect(router.push).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      'Signed-in account changed',
      expect.any(String)
    );
    expect(params.setIsFundPending).toHaveBeenLastCalledWith(false);
    alert.mockRestore();
  });
});

describe('bugfix: legacy checkout carried no owner stamp', () => {
  it('stamps the starting account into the gateway params', async () => {
    await startLegacyWalletTopUp(params);

    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ userId: 'user-a' }),
      })
    );
  });
});

describe('bugfix: account-change notice bound to the previous account', () => {
  it('reports the switch through a fresh notifier, not the pre-request one', async () => {
    // Arrange: the switch happens while the request is in flight.
    const staleNotify = jest.fn();
    jest.mocked(initializeWalletTopUp).mockImplementation(async () => {
      mockSameUser = false;
      return {
        authorization_url: 'https://checkout.example.com/pay',
        checkout_url: 'https://checkout.example.com/pay',
        gateway: 'paystack',
        reference: 'WAL-1',
        success: true,
      } as never;
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    // Act
    await startLegacyWalletTopUp({ ...params, notify: staleNotify });

    // Assert: the stale scope's notifier is never used for this outcome.
    expect(staleNotify).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      'Signed-in account changed',
      expect.any(String)
    );
    alert.mockRestore();
  });
});

describe('bugfix: account switch during credential reads dropped the message', () => {
  it('reports the initialize failure through a fresh notifier', async () => {
    // Arrange: initialization rejects because another account signed in
    // while getUser()/getSession() ran.
    const staleNotify = jest.fn();
    jest
      .mocked(initializeWalletTopUp)
      .mockRejectedValue(
        new Error(
          'You switched accounts. Start the top-up again from this account.'
        )
      );
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    // Act
    await startLegacyWalletTopUp({ ...params, notify: staleNotify });

    // Assert: shown to the account signed in now, never via the stale one.
    expect(staleNotify).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      'Top-up Failed',
      'You switched accounts. Start the top-up again from this account.'
    );
    expect(router.push).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
