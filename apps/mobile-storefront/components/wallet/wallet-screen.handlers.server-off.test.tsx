import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { initializeWalletTopUp } from '@/lib/wallet-top-up';
import { fundWallet } from './wallet-screen.handlers';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/wallet-top-up', () => ({ initializeWalletTopUp: jest.fn() }));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  }),
}));
jest.mock('@/services/analytics', () => ({
  trackError: jest.fn(),
  trackEvent: jest.fn(),
}));
jest.mock('@/services/push-notifications', () => ({
  scheduleLocalNotification: jest.fn(),
}));

const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const mockInitializeWalletTopUp = jest.mocked(initializeWalletTopUp);

describe('card top-up with the server keeping PiggyVest off', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitializeWalletTopUp.mockResolvedValue({
      authorization_url: 'https://pay.example/authorize',
      gateway: 'paystack',
      reference: 'ref-1',
      success: true,
    });
  });

  it('runs the regular wallet top-up for an IMEI check return, as today', async () => {
    await fundWallet({
      fundAmount: '1000',
      resetFundPanel: jest.fn(),
      setIsFundPending: jest.fn(),
      walletReturnTo: '/imei-check',
    });

    expect(mockInitializeWalletTopUp).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000, returnTo: '/imei-check' })
    );
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/payment-gateway' })
    );
  });

  it('adds store credit for the PiggyVest pilot merchant without trying the PiggyVest card rail', async () => {
    await fundWallet({
      activeMerchantId: PILOT,
      fundAmount: '1000',
      resetFundPanel: jest.fn(),
      setIsFundPending: jest.fn(),
      user: { id: '11111111-1111-4111-8111-111111111111' } as never,
      walletReturnTo: '/utilities/airtime?repeatAmount=1000',
    });

    expect(mockInitializeWalletTopUp).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000, merchantId: PILOT })
    );
  });
});
