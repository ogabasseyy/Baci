import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import { redeemWalletPoints } from './redeem-wallet-points';

const mockNotify = jest.fn();
jest.mock('./savings/savings-notifier', () => ({
  savingsNotifier: () => mockNotify,
}));
jest.mock('@/services/analytics', () => ({
  trackError: jest.fn(),
  trackEvent: jest.fn(),
}));
jest.mock('@/services/push-notifications', () => ({
  scheduleLocalNotification: jest.fn(async () => undefined),
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn() }),
}));

describe('redeeming points with the server keeping PiggyVest off', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('confirms with the wallet notice and closes the panel, no iOS alert', async () => {
    const iosAlert = jest.spyOn(Alert, 'alert');
    const closeRedeemPanel = jest.fn();
    const clearRedeemPoints = jest.fn();

    await redeemWalletPoints({
      clearRedeemPoints,
      closeRedeemPanel,
      rawPoints: '200',
      redeemPoints: async () => ({
        conversionRate: 7.5,
        remainingPoints: 0,
        walletCredit: 1500,
      }),
    } as unknown as Parameters<typeof redeemWalletPoints>[0]);

    expect(mockNotify).toHaveBeenCalledWith(
      'Points redeemed',
      expect.any(String),
      'success'
    );
    expect(closeRedeemPanel).toHaveBeenCalledTimes(1);
    expect(clearRedeemPoints).toHaveBeenCalledTimes(1);
    expect(iosAlert).not.toHaveBeenCalled();
  });

  it('explains too few points inline', async () => {
    await redeemWalletPoints({
      clearRedeemPoints: jest.fn(),
      closeRedeemPanel: jest.fn(),
      rawPoints: '1',
      redeemPoints: jest.fn(),
    } as unknown as Parameters<typeof redeemWalletPoints>[0]);

    expect(mockNotify).toHaveBeenCalledWith(
      'Invalid Points',
      expect.any(String),
      'warning'
    );
  });
});
