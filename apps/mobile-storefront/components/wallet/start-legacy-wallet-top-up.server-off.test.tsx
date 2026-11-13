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
