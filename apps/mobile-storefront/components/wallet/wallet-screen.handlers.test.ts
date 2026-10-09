import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { initializeWalletTopUp } from '@/lib/wallet-top-up';
import { trackEvent } from '@/services/analytics';
import { scheduleLocalNotification } from '@/services/push-notifications';
import { WALLET_FUNDING_ACCOUNT_MESSAGES } from './wallet-funding-account.constants';
import {
  createWalletFundingAccount,
  fundWallet,
  redeemWalletPoints,
} from './wallet-screen.handlers';

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
  },
}));

jest.mock('@/lib/wallet-top-up', () => ({
  initializeWalletTopUp: jest.fn(),
}));

const mockFundPrimaryWalletCard =
  jest.fn<(...args: never[]) => Promise<void>>();
jest.mock('./fund-primary-wallet-card', () => ({
  fundPrimaryWalletCard: (...args: never[]) =>
    mockFundPrimaryWalletCard(...args),
}));

// These suites pin the known-verdict paths: merchant-1 is observed
// non-primary, so funding must route legacy without probing.
const mockGetCapability = jest
  .fn<(...args: unknown[]) => Promise<boolean>>()
  .mockRejectedValue(new Error('must not probe on a known verdict'));
const mockReadObserved = jest
  .fn<(...args: unknown[]) => boolean | null>()
  .mockReturnValue(false);
jest.mock('@/lib/piggyvest-primary-capability', () => {
  const actual = jest.requireActual(
    '@/lib/piggyvest-primary-capability'
  ) as typeof import('@/lib/piggyvest-primary-capability');
  return {
    ...actual,
    getPiggyvestPrimaryCapability: (...args: unknown[]) =>
      mockGetCapability(...args),
  };
});
jest.mock('@/lib/piggyvest-primary-capability-cache', () => {
  const actual = jest.requireActual(
    '@/lib/piggyvest-primary-capability-cache'
  ) as typeof import('@/lib/piggyvest-primary-capability-cache');
  return {
    ...actual,
    readObservedPiggyvestPrimaryCapability: (...args: unknown[]) =>
      mockReadObserved(...args),
  };
});

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

jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
const mockInitializeWalletTopUp = jest.mocked(initializeWalletTopUp);
const mockScheduleLocalNotification = jest.mocked(scheduleLocalNotification);
const mockTrackEvent = jest.mocked(trackEvent);
const mockRouterPush = jest.mocked(router.push);

describe('wallet-screen.handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks account creation when the customer phone is missing', async () => {
    const createFundingAccount = jest.fn(async () => ({ account: null }));

    await createWalletFundingAccount({
      createFundingAccount,
      customerPhone: '',
      isPaymentSettingsError: false,
      isPaymentSettingsPending: false,
      walletDvaEnabled: true,
    });

    expect(createFundingAccount).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Phone number required',
      WALLET_FUNDING_ACCOUNT_MESSAGES.PHONE_REQUIRED
    );
  });

  it('does not duplicate the funding sheet with a success alert when account details exist', async () => {
    await createWalletFundingAccount({
      createFundingAccount: async () => ({
        account: {
          accountNumber: '1234567890',
          bankName: 'Kuda',
        },
      }),
      customerPhone: '08012345678',
      isPaymentSettingsError: false,
      isPaymentSettingsPending: false,
      walletDvaEnabled: true,
    });

    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('shows the phone prompt instead of alerting on CUSTOMER_PHONE_REQUIRED', async () => {
    const onPhoneRequired = jest.fn();

    const created = await createWalletFundingAccount({
      createFundingAccount: async () => {
        const error = new Error('Add a phone number first') as Error & {
          code?: string;
        };
        error.code = 'CUSTOMER_PHONE_REQUIRED';
        throw error;
      },
      customerPhone: '08012345678',
      isPaymentSettingsError: false,
      isPaymentSettingsPending: false,
      onPhoneRequired,
      walletDvaEnabled: true,
    });

    expect(created).toBe(false);
    expect(onPhoneRequired).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalledWith(
      'Unable to create account number',
      expect.anything()
    );
  });

  it('validates top-up amount before starting payment', async () => {
    await fundWallet({
      fundAmount: '50',
      resetFundPanel: jest.fn(),
      setIsFundPending: jest.fn(),
    });

    expect(mockInitializeWalletTopUp).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Invalid Amount',
      expect.stringContaining('between')
    );
  });

  it('does not attempt wallet payment in the hosted staging preview', async () => {
    const previous = {
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      hosted: process.env.EXPO_PUBLIC_HOSTED_STOREFRONT,
      payments: process.env.EXPO_PUBLIC_STAGING_TEST_PAYMENTS,
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    };
    try {
      process.env.EXPO_PUBLIC_API_URL = 'https://staging.ogabassey.com';
      process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
      process.env.EXPO_PUBLIC_SUPABASE_URL =
        'https://staging-auth.ogabassey.com';
      delete process.env.EXPO_PUBLIC_STAGING_TEST_PAYMENTS;
      await fundWallet({
        fundAmount: '500',
        resetFundPanel: jest.fn(),
        setIsFundPending: jest.fn(),
      });

      expect(mockInitializeWalletTopUp).not.toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenCalledWith(
        'Wallet top-up unavailable',
        expect.stringContaining('hosted staging preview')
      );
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

  it('starts a wallet top-up and routes to the payment gateway', async () => {
    const resetFundPanel = jest.fn();
    const setIsFundPending = jest.fn();
    mockInitializeWalletTopUp.mockResolvedValue({
      authorization_url: 'https://pay.example/authorize',
      gateway: 'paystack',
      reference: 'ref-123',
      success: true,
    });

    await fundWallet({
      activeMerchantId: 'merchant-1',
      activeMerchantSlug: 'ogabassey',
      customer: {
        first_name: 'Ada',
        id: 'customer-1',
        last_name: 'Buyer',
        phone: '08012345678',
      },
      fundAmount: '5000',
      resetFundPanel,
      setIsFundPending,
      user: null,
      walletReturnTo: '/checkout',
    });

    expect(setIsFundPending).toHaveBeenNthCalledWith(1, true);
    // The interrupted-purchase destination rides to the server so the
    // wallet-credited push can deep-link back.
    expect(mockInitializeWalletTopUp).toHaveBeenCalledWith(
      expect.objectContaining({ returnTo: '/checkout' })
    );
    // A known non-primary verdict routes legacy without probing.
    expect(mockGetCapability).not.toHaveBeenCalled();
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'wallet_top_up_started',
      expect.objectContaining({ amount: 5000, gateway: 'paystack' })
    );
    expect(resetFundPanel).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/payment-gateway',
      params: expect.objectContaining({
        amount: '5000',
        merchantId: 'merchant-1',
        reference: 'ref-123',
      }),
    });
    expect(setIsFundPending).toHaveBeenLastCalledWith(false);
  });

  it('falls back to the legacy top-up when primary reports unconfigured', async () => {
    mockFundPrimaryWalletCard.mockRejectedValue(
      Object.assign(new Error('unavailable'), {
        code: 'PRIMARY_CARD_NOT_READY',
      })
    );
    mockInitializeWalletTopUp.mockResolvedValue({
      authorization_url: 'https://pay.example/authorize',
      gateway: 'paystack',
      reference: 'ref-legacy',
      success: true,
    });

    await fundWallet({
      activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      activeMerchantSlug: 'ogabassey',
      customer: {
        first_name: 'Ada',
        id: 'customer-1',
        last_name: 'Buyer',
        phone: '08012345678',
      },
      fundAmount: '5000',
      resetFundPanel: jest.fn(),
      setIsFundPending: jest.fn(),
      user: null,
      walletReturnTo: undefined,
    });

    expect(mockFundPrimaryWalletCard).toHaveBeenCalledTimes(1);
    expect(mockInitializeWalletTopUp).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/payment-gateway',
      params: expect.objectContaining({ reference: 'ref-legacy' }),
    });
  });
  it('returns a savings-origin top-up to the plan without submitting a savings transfer', async () => {
    mockInitializeWalletTopUp.mockResolvedValue({
      authorization_url: 'https://pay.example/authorize',
      gateway: 'paystack',
      reference: 'ref-savings',
      success: true,
    });

    await fundWallet({
      fundAmount: '400',
      resetFundPanel: jest.fn(),
      setIsFundPending: jest.fn(),
      walletReturnTo: '/wallet?action=savings',
    });

    expect(mockInitializeWalletTopUp).toHaveBeenCalledWith(
      expect.objectContaining({ returnTo: '/wallet?action=savings' })
    );
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/payment-gateway',
      params: expect.objectContaining({
        amount: '400',
        returnTo: '/wallet?action=savings',
      }),
    });
  });

  it('rejects invalid loyalty redemption input before calling the mutation', async () => {
    const redeemPoints = jest.fn(async () => ({ walletCredit: 0 }));

    await redeemWalletPoints({
      clearRedeemPoints: jest.fn(),
      closeRedeemPanel: jest.fn(),
      rawPoints: '50',
      redeemPoints,
    });

    expect(redeemPoints).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Invalid Points',
      'Minimum redemption is 100 points'
    );
  });

  it('redeems points, schedules a notification, and clears the input', async () => {
    const clearRedeemPoints = jest.fn();
    const closeRedeemPanel = jest.fn();
    mockScheduleLocalNotification.mockResolvedValue(null);

    await redeemWalletPoints({
      clearRedeemPoints,
      closeRedeemPanel,
      customerId: 'customer-1',
      rawPoints: '200',
      redeemPoints: async () => ({
        conversionRate: 2,
        remainingPoints: 800,
        walletCredit: 1500,
      }),
    });

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'loyalty_redeemed',
      expect.objectContaining({ points_redeemed: 200, wallet_credit: 1500 })
    );
    expect(mockScheduleLocalNotification).toHaveBeenCalledWith(
      'Points Redeemed! 🎁',
      '200 points converted to ₦1,500 wallet credit.',
      { type: 'loyalty_redemption', points: 200 },
      1
    );
    expect(Alert.alert).toHaveBeenCalledWith(
      'Points Redeemed!',
      '200 points converted to ₦1,500 wallet credit.',
      [{ text: 'OK', onPress: closeRedeemPanel }]
    );
    expect(clearRedeemPoints).toHaveBeenCalledTimes(1);
  });
});
