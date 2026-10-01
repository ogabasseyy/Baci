import { jest } from '@jest/globals';
import {
  createWalletFundedBankTransferIntent,
  getWalletFundingErrorDetails,
  WALLET_CONSENT_DENIED,
} from './wallet-funded-bank-transfer';

const mockCreateOrderWalletFundingIntent =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCreateWalletFundingAccount =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('@/lib/order-wallet-funding-intent', () => ({
  createOrderWalletFundingIntent: (...args: unknown[]) =>
    mockCreateOrderWalletFundingIntent(...args),
}));

jest.mock('@/lib/wallet-funding-account', () => ({
  createWalletFundingAccount: (...args: unknown[]) =>
    mockCreateWalletFundingAccount(...args),
}));

const response = {
  account: {
    accountName: 'Ogabassey Jane',
    accountNumber: '9971002551',
    bankName: 'Paystack-Titan',
    provider: 'paystack',
  },
  intent: {
    currency: 'NGN',
    expectedAmount: 20000,
    expiresAt: '2026-05-27T12:00:00.000Z',
    fundedAmount: 0,
    id: '11111111-1111-4111-8111-111111111111',
    orderId: '22222222-2222-4222-8222-222222222222',
    status: 'pending',
    targetOrderAmount: 20000,
  },
};

describe('createWalletFundedBankTransferIntent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateOrderWalletFundingIntent.mockResolvedValue(response);
    mockCreateWalletFundingAccount.mockResolvedValue({
      account: response.account,
    });
  });

  it('normalizes wallet funding error details without losing the original error', () => {
    const error = new Error('Paystack unavailable') as Error & {
      code?: string;
    };
    error.code = 'WALLET_DVA_SETUP_FAILED';

    expect(getWalletFundingErrorDetails(error)).toEqual({
      code: 'WALLET_DVA_SETUP_FAILED',
      error,
      message: 'Paystack unavailable',
    });
    expect(getWalletFundingErrorDetails('boom')).toEqual({
      code: undefined,
      error: 'boom',
      message: 'boom',
    });
    expect(getWalletFundingErrorDetails({ message: 'server says no' })).toEqual(
      {
        code: undefined,
        error: { message: 'server says no' },
        message: 'server says no',
      }
    );
  });

  it('routes to the wallet-funded transfer screen when an intent already exists', async () => {
    const onSuccess = jest.fn();
    const onFallback = jest.fn();

    await expect(
      createWalletFundedBankTransferIntent({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        onFallback,
        onSuccess,
        orderId: 'order-1',
        requestConsent: jest.fn<() => Promise<boolean>>(),
      })
    ).resolves.toBe(response);

    expect(onSuccess).toHaveBeenCalledWith(response);
    expect(mockCreateWalletFundingAccount).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('requests consent, creates the wallet account, and retries the intent', async () => {
    const consentError = new Error('Consent required') as Error & {
      code?: string;
    };
    consentError.code = 'WALLET_DVA_CONSENT_REQUIRED';
    mockCreateOrderWalletFundingIntent
      .mockRejectedValueOnce(consentError)
      .mockResolvedValueOnce(response);
    const onSuccess = jest.fn();

    await expect(
      createWalletFundedBankTransferIntent({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        onFallback: jest.fn(),
        onSuccess,
        orderId: 'order-1',
        requestConsent: jest.fn(() => Promise.resolve(true)),
      })
    ).resolves.toBe(response);

    expect(mockCreateWalletFundingAccount).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    });
    expect(onSuccess).toHaveBeenCalledWith(response);
  });

  it('reports fallback when the consent retry fails after account creation', async () => {
    const consentError = new Error('Consent required') as Error & {
      code?: string;
    };
    consentError.code = 'WALLET_DVA_CONSENT_REQUIRED';
    const retryError = new Error('Intent creation failed') as Error & {
      code?: string;
    };
    retryError.code = 'INTENT_CREATION_FAILED';
    mockCreateOrderWalletFundingIntent
      .mockRejectedValueOnce(consentError)
      .mockRejectedValueOnce(retryError);
    const onFallback = jest.fn();
    const onSuccess = jest.fn();

    await expect(
      createWalletFundedBankTransferIntent({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        onFallback,
        onSuccess,
        orderId: 'order-1',
        requestConsent: jest.fn(() => Promise.resolve(true)),
      })
    ).resolves.toBeNull();

    expect(mockCreateWalletFundingAccount).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    });
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'INTENT_CREATION_FAILED',
        consent: true,
        message: 'Intent creation failed',
      })
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('returns false with a fallback when consent is declined', async () => {
    const consentError = new Error('Consent required') as Error & {
      code?: string;
    };
    consentError.code = 'WALLET_DVA_CONSENT_REQUIRED';
    mockCreateOrderWalletFundingIntent.mockRejectedValueOnce(consentError);
    const onFallback = jest.fn();

    await expect(
      createWalletFundedBankTransferIntent({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        onFallback,
        onSuccess: jest.fn(),
        orderId: 'order-1',
        requestConsent: jest.fn(() => Promise.resolve(false)),
      })
    ).resolves.toBeNull();

    expect(mockCreateWalletFundingAccount).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledWith({
      code: WALLET_CONSENT_DENIED,
      consent: false,
      error: null,
      message: 'User denied wallet consent',
    });
  });

  it('reports consent prompt failures without creating an account', async () => {
    const consentError = new Error('Consent required') as Error & {
      code?: string;
    };
    consentError.code = 'WALLET_DVA_CONSENT_REQUIRED';
    mockCreateOrderWalletFundingIntent.mockRejectedValueOnce(consentError);
    const promptError = new Error('consent failed');
    const onFallback = jest.fn();
    const onSuccess = jest.fn();

    await expect(
      createWalletFundedBankTransferIntent({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        onFallback,
        onSuccess,
        orderId: 'order-1',
        requestConsent: jest.fn(() => Promise.reject(promptError)),
      })
    ).resolves.toBeNull();

    expect(mockCreateWalletFundingAccount).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledWith({
      code: undefined,
      consent: false,
      error: promptError,
      message: 'consent failed',
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('reports fallbacks before and after consent', async () => {
    const setupError = new Error('Paystack unavailable') as Error & {
      code?: string;
    };
    setupError.code = 'WALLET_DVA_SETUP_FAILED';
    const onFallback = jest.fn();
    mockCreateOrderWalletFundingIntent.mockRejectedValueOnce(setupError);

    await createWalletFundedBankTransferIntent({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      onFallback,
      onSuccess: jest.fn(),
      orderId: 'order-1',
      requestConsent: jest.fn<() => Promise<boolean>>(),
    });
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'WALLET_DVA_SETUP_FAILED',
        consent: false,
        message: 'Paystack unavailable',
      })
    );

    onFallback.mockClear();
    const consentError = new Error('Consent required') as Error & {
      code?: string;
    };
    consentError.code = 'WALLET_DVA_CONSENT_REQUIRED';
    mockCreateOrderWalletFundingIntent.mockRejectedValueOnce(consentError);
    mockCreateWalletFundingAccount.mockRejectedValueOnce(setupError);

    await createWalletFundedBankTransferIntent({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      onFallback,
      onSuccess: jest.fn(),
      orderId: 'order-1',
      requestConsent: jest.fn(() => Promise.resolve(true)),
    });
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'WALLET_DVA_SETUP_FAILED',
        consent: true,
        message: 'Paystack unavailable',
      })
    );
  });
});
