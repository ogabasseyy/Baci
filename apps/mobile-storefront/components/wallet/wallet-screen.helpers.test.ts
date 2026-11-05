import { VTU_MIN_REDEEMABLE_POINTS } from '@baci/shared/lib';
import { WALLET_TOP_UP_MIN_AMOUNT } from '@/lib/wallet-top-up-constants';
import { WALLET_FUNDING_ACCOUNT_MESSAGES } from './wallet-funding-account.constants';
import {
  buildWalletTopUpGatewayParams,
  deriveWalletDisplayData,
  getWalletCustomerName,
  getWalletLoadingMessage,
  parseWalletRedeemPointsInput,
  resolveCreateFundingAccountOutcome,
  resolveWalletRedeemPointsOutcome,
  sanitizeWalletFundAmount,
  validateWalletTopUpAmount,
} from './wallet-screen.helpers';

describe('wallet-screen.helpers', () => {
  it('sanitizes wallet fund amount input', () => {
    expect(sanitizeWalletFundAmount('₦12,500.90')).toBe('1250090');
  });

  it('validates wallet top-up amount boundaries', () => {
    expect(validateWalletTopUpAmount(WALLET_TOP_UP_MIN_AMOUNT - 1)).toContain(
      'between'
    );
    expect(validateWalletTopUpAmount(WALLET_TOP_UP_MIN_AMOUNT)).toBeNull();
    expect(validateWalletTopUpAmount(1_000_000_001)).toContain('between');
  });

  it('resolves wallet customer name fallback chain', () => {
    expect(
      getWalletCustomerName(
        { first_name: 'Jane', last_name: 'Doe', email: 'jane@x.com' },
        { email: 'user@x.com' }
      )
    ).toBe('Jane Doe');
    expect(
      getWalletCustomerName({ email: 'jane@x.com' }, { email: 'u@x.com' })
    ).toBe('jane@x.com');
    expect(getWalletCustomerName(null, { email: 'u@x.com' })).toBe('u@x.com');
    expect(getWalletCustomerName(null, null)).toBe('Customer');
  });

  it('builds payment-gateway params for wallet top-up', () => {
    expect(
      buildWalletTopUpGatewayParams({
        activeMerchantId: 'm-1',
        activeMerchantSlug: 'ogabassey',
        amount: 25000,
        result: {
          authorization_url: 'https://pay.example/authorize',
          gateway: 'paystack',
          reference: 'REF123',
        },
        walletReturnTo: '/checkout',
      })
    ).toEqual({
      amount: '25000',
      authorizationUrl: 'https://pay.example/authorize',
      gateway: 'paystack',
      merchantId: 'm-1',
      merchantSlug: 'ogabassey',
      paymentKind: 'wallet',
      reference: 'REF123',
      returnTo: '/checkout',
    });
  });

  it('parses redeem points input and validates constraints', () => {
    expect(
      parseWalletRedeemPointsInput('abc', VTU_MIN_REDEEMABLE_POINTS)
    ).toEqual({
      title: 'Invalid Input',
      message: 'Please enter a valid number of points',
    });
    expect(
      parseWalletRedeemPointsInput('50', VTU_MIN_REDEEMABLE_POINTS)
    ).toEqual({
      title: 'Invalid Points',
      message: 'Minimum redemption is 100 points',
    });
    expect(
      parseWalletRedeemPointsInput('150', VTU_MIN_REDEEMABLE_POINTS)
    ).toEqual({
      title: 'Invalid Points',
      message: 'Redeem points in 100-point blocks',
    });
    expect(
      parseWalletRedeemPointsInput('200', VTU_MIN_REDEEMABLE_POINTS)
    ).toEqual({ points: 200 });
  });

  it('derives wallet loading messages', () => {
    expect(
      getWalletLoadingMessage({
        hasMerchantContext: false,
        hasWalletData: false,
        isError: false,
        isLoading: false,
        user: null,
      })
    ).toBe('Preparing your wallet...');

    expect(
      getWalletLoadingMessage({
        hasMerchantContext: true,
        hasWalletData: false,
        isError: true,
        isLoading: false,
        user: { id: 'u1' },
      })
    ).toBe('Unable to load wallet.');

    expect(
      getWalletLoadingMessage({
        hasMerchantContext: true,
        hasWalletData: false,
        isError: false,
        isLoading: false,
        user: { id: 'u1' },
      })
    ).toBe('Preparing your wallet...');

    expect(
      getWalletLoadingMessage({
        hasMerchantContext: true,
        hasWalletData: true,
        isError: false,
        isLoading: false,
        user: { id: 'u1' },
      })
    ).toBeUndefined();
  });

  it('derives wallet display data', () => {
    expect(
      deriveWalletDisplayData({
        active_savings_goal: {
          contribution_amount: 10000,
          contribution_frequency: 'weekly',
          current_amount: 60,
          id: 'goal-1',
          maturity_date: '2026-09-30',
          source_mode: 'manual',
          status: 'active',
          target_amount: 100,
          title: 'Device goal',
        },
        balance: 10,
        earnings_available: true,
        earnings_balance: 40,
        funding_account: {
          account_name: 'Jane Doe',
          account_number: '1234567890',
          bank_name: 'Kuda',
          provider: 'paystack',
        },
        savings_balance: 60,
        total_balance: null,
      })
    ).toEqual({
      activeSavingsGoal: {
        contribution_amount: 10000,
        contribution_frequency: 'weekly',
        current_amount: 60,
        id: 'goal-1',
        maturity_date: '2026-09-30',
        source_mode: 'manual',
        status: 'active',
        target_amount: 100,
        title: 'Device goal',
      },
      earningsAvailable: true,
      earningsBalance: 40,
      fundingAccount: {
        accountName: 'Jane Doe',
        accountNumber: '1234567890',
        bankName: 'Kuda',
        provider: 'paystack',
      },
      savingsBalance: 60,
      showQuickSave: true,
      spendableBalance: 10,
      totalBalance: 70,
    });
  });

  it('resolves funding-account creation outcomes', async () => {
    await expect(
      resolveCreateFundingAccountOutcome(async () => ({
        account: {
          accountNumber: '1234567890',
          bankName: 'Kuda',
        },
      }))
    ).resolves.toEqual({
      accountSummary: 'Kuda - 1234567890',
      status: 'success',
    });

    await expect(
      resolveCreateFundingAccountOutcome(async () => ({
        account: {
          accountNumber: '   ',
          bankName: 'Kuda',
        },
      }))
    ).resolves.toEqual({ status: 'success' });

    await expect(
      resolveCreateFundingAccountOutcome(async () => {
        throw new Error('Request failed');
      })
    ).resolves.toEqual({
      alertMessage: 'Request failed',
      status: 'error',
      telemetryMessage: 'Request failed',
    });
  });

  it('maps the order-reservation conflict to actionable copy while keeping raw telemetry', async () => {
    const serverMessage =
      'This Paystack account is still reserved for an active order payment';

    await expect(
      resolveCreateFundingAccountOutcome(async () => {
        throw new Error(serverMessage);
      })
    ).resolves.toEqual({
      alertMessage: WALLET_FUNDING_ACCOUNT_MESSAGES.ORDER_PAYMENT_IN_PROGRESS,
      status: 'error',
      telemetryMessage: serverMessage,
    });
  });

  it('maps a CUSTOMER_PHONE_REQUIRED rejection to the phone-required outcome', async () => {
    await expect(
      resolveCreateFundingAccountOutcome(async () => {
        const error = new Error('Add a phone number first') as Error & {
          code?: string;
        };
        error.code = 'CUSTOMER_PHONE_REQUIRED';
        throw error;
      })
    ).resolves.toEqual({ status: 'phone-required' });
  });

  it('resolves redeem-point outcomes for invalid, success, and error paths', async () => {
    await expect(
      resolveWalletRedeemPointsOutcome({
        minimumRedeemablePoints: VTU_MIN_REDEEMABLE_POINTS,
        rawPoints: 'abc',
        redeemPoints: async () => ({ walletCredit: 0 }),
      })
    ).resolves.toEqual({
      message: 'Please enter a valid number of points',
      status: 'invalid',
      title: 'Invalid Input',
    });

    await expect(
      resolveWalletRedeemPointsOutcome({
        minimumRedeemablePoints: VTU_MIN_REDEEMABLE_POINTS,
        rawPoints: '200',
        redeemPoints: async () => ({
          conversionRate: 2,
          remainingPoints: 800,
          walletCredit: 1500,
        }),
      })
    ).resolves.toEqual({
      points: 200,
      result: {
        conversionRate: 2,
        remainingPoints: 800,
        walletCredit: 1500,
      },
      status: 'success',
      successMessage: '200 points converted to ₦1,500 wallet credit.',
    });

    await expect(
      resolveWalletRedeemPointsOutcome({
        minimumRedeemablePoints: VTU_MIN_REDEEMABLE_POINTS,
        rawPoints: '200',
        redeemPoints: async () => {
          throw new Error('Redeem failed');
        },
      })
    ).resolves.toEqual({
      alertMessage: 'Redeem failed',
      points: 200,
      status: 'error',
      telemetryMessage: 'Redeem failed',
    });
  });

  it('falls back balances and nulls incomplete funding account data', () => {
    expect(
      deriveWalletDisplayData({
        balance: 15,
        earnings_balance: null,
        funding_account: {
          account_name: 'Jane Doe',
          account_number: '   ',
          bank_name: 'Kuda',
          provider: 'paystack',
        },
        savings_balance: 30,
        total_balance: null,
      })
    ).toEqual({
      activeSavingsGoal: null,
      earningsAvailable: false,
      earningsBalance: null,
      fundingAccount: null,
      savingsBalance: 30,
      showQuickSave: false,
      spendableBalance: 15,
      totalBalance: 45,
    });

    expect(deriveWalletDisplayData({})).toEqual({
      activeSavingsGoal: null,
      earningsAvailable: false,
      earningsBalance: null,
      fundingAccount: null,
      savingsBalance: 0,
      showQuickSave: false,
      spendableBalance: 0,
      totalBalance: 0,
    });
  });
});
