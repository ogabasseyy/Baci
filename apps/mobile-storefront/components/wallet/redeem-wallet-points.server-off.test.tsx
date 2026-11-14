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

const PIGGYVEST_MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const redeemed = async () => ({
  conversionRate: 7.5,
  remainingPoints: 0,
  walletCredit: 1500,
});
type Params = Parameters<typeof redeemWalletPoints>[0];

describe('redeeming points with the server keeping PiggyVest off', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps today’s alert for another store: OK closes the panel', async () => {
    const iosAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const closeRedeemPanel = jest.fn();
    const clearRedeemPoints = jest.fn();

    await redeemWalletPoints({
      activeMerchantId: '11111111-1111-4111-8111-111111111111',
      clearRedeemPoints,
      closeRedeemPanel,
      rawPoints: '200',
      redeemPoints: redeemed,
    } as unknown as Params);

    expect(iosAlert).toHaveBeenCalledWith(
      'Points Redeemed!',
      expect.any(String),
      [{ text: 'OK', onPress: closeRedeemPanel }]
    );
    expect(mockNotify).not.toHaveBeenCalled();
    expect(closeRedeemPanel).not.toHaveBeenCalled();
    expect(clearRedeemPoints).toHaveBeenCalledTimes(1);
  });

  it('confirms inline and closes the panel for the PiggyVest merchant', async () => {
    const iosAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const closeRedeemPanel = jest.fn();

    await redeemWalletPoints({
      activeMerchantId: PIGGYVEST_MERCHANT,
      clearRedeemPoints: jest.fn(),
      closeRedeemPanel,
      rawPoints: '200',
      redeemPoints: redeemed,
    } as unknown as Params);

    expect(mockNotify).toHaveBeenCalledWith(
      'Points redeemed',
      expect.any(String),
      'success'
    );
    expect(closeRedeemPanel).toHaveBeenCalledTimes(1);
    expect(iosAlert).not.toHaveBeenCalled();
  });
});
