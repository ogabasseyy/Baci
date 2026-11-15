import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Alert } from 'react-native';
import { ensureUtilityWalletReady } from './utility-wallet-readiness';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (route: unknown) => mockPush(route) },
}));

// With the server keeping PiggyVest off neither verdict is present, so a
// shortfall keeps today's "Fund Your Wallet" prompt.
function payment(balance: number) {
  return {
    canFundByBankTransfer: false,
    captureSubmittingUserId: () => 'user-1',
    getWalletBalance: () => balance,
    getWalletError: () => null,
    isAuthenticated: true,
    isWalletRefetching: () => false,
    isWalletSettled: () => true,
    refetchWallet: () => {},
    walletIsLoading: false,
  };
}

describe('ensureUtilityWalletReady (server off)', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the wallet funding prompt on a shortfall', () => {
    expect(
      ensureUtilityWalletReady({ amount: 1000, payment: payment(200) })
    ).toBe(false);
    expect((Alert.alert as unknown as jest.Mock).mock.calls[0][0]).toBe(
      'Fund Your Wallet'
    );
  });

  it('passes when the wallet covers the amount', () => {
    expect(
      ensureUtilityWalletReady({ amount: 1000, payment: payment(5000) })
    ).toBe(true);
  });
});
