import { expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { initializeWalletTopUp } from '@/lib/wallet-top-up';
import { fundWallet } from './wallet-screen.handlers';

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
  },
}));

jest.mock('@/lib/wallet-top-up', () => ({
  initializeWalletTopUp: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: jest.fn(),
  }),
}));

jest.mock('@/services/analytics', () => ({
  trackError: jest.fn(),
  trackEvent: jest.fn(),
}));

jest.mock('@/services/push-notifications', () => ({
  scheduleLocalNotification: jest.fn(),
}));

const mockInitializeWalletTopUp = jest.mocked(initializeWalletTopUp);
const mockRouterPush = jest.mocked(router.push);

it('starts the existing wallet checkout only with the pinned staging test capability', async () => {
  const previous = {
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    hosted: process.env.EXPO_PUBLIC_HOSTED_STOREFRONT,
    payments: process.env.EXPO_PUBLIC_STAGING_TEST_PAYMENTS,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  };
  try {
    process.env.EXPO_PUBLIC_API_URL = 'https://staging.ogabassey.com';
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
    process.env.EXPO_PUBLIC_STAGING_TEST_PAYMENTS = '1';
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://staging-auth.ogabassey.com';
    mockInitializeWalletTopUp.mockResolvedValue({
      authorization_url: 'https://pay.example/authorize',
      gateway: 'paystack',
      reference: 'test-ref-123',
      success: true,
    });

    await fundWallet({
      fundAmount: '500',
      resetFundPanel: jest.fn(),
      setIsFundPending: jest.fn(),
      walletReturnTo: '/wallet?action=savings',
    });

    expect(mockInitializeWalletTopUp).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/payment-gateway',
      params: expect.objectContaining({ reference: 'test-ref-123' }),
    });
  } finally {
    if (previous.apiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = previous.apiUrl;
    if (previous.hosted === undefined)
      delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
    else process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = previous.hosted;
    if (previous.payments === undefined)
      delete process.env.EXPO_PUBLIC_STAGING_TEST_PAYMENTS;
    else process.env.EXPO_PUBLIC_STAGING_TEST_PAYMENTS = previous.payments;
    if (previous.supabaseUrl === undefined)
      delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = previous.supabaseUrl;
  }
});
