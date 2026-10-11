import { jest } from '@jest/globals';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import {
  buildVtuPurchaseDescriptor,
  notePendingVtuReference,
  rememberPendingVtuPurchase,
} from '@/lib/pending-vtu-idempotency';
import { createDataFormPurchaseHandler } from './create-data-form-purchase-handler';

type PaymentState = ReturnType<typeof useUtilityPayment>;

const mockChargeWalletForVtu =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('@/lib/vtu-checkout', () => {
  const actual =
    jest.requireActual<typeof import('@/lib/vtu-checkout')>(
      '@/lib/vtu-checkout'
    );
  return {
    ...actual,
    chargeWalletForVtu: (...args: unknown[]) => mockChargeWalletForVtu(...args),
  };
});

jest.mock('@/lib/utility-wallet-readiness', () => ({
  ensureUtilityWalletReady: jest.fn(() => true),
}));

describe('data stale success replay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function runPurchase(
    overrides: {
      onSuccess?: jest.Mock;
      resetWalletIdempotencyKey?: jest.Mock;
    } = {}
  ) {
    const handlePurchase = createDataFormPurchaseHandler({
      customer: null,
      dismissKeyboard: jest.fn(),
      getIsSubmitting: () => false,
      onSuccess: overrides.onSuccess ?? jest.fn(),
      payment: {
        canFundByBankTransfer: false,
        isAuthenticated: true,
        refetchWallet: jest.fn(),
        walletBalance: 5000,
        walletError: null,
        walletIsLoading: false,
        getWalletIdempotencyKey: jest.fn(() => 'stale-data-key'),
        resetWalletIdempotencyKey:
          overrides.resetWalletIdempotencyKey ?? jest.fn(),
      } as PaymentState,
      phoneNumber: '08031234567',
      planAmount: 1000,
      selectedPlan: 'MTN-DATA-1GB',
      selectedProvider: 'mtn',
      setIsSubmitting: jest.fn(),
    });
    return handlePurchase();
  }

  function seedPendingFromLastCall(reference: string) {
    const submitted = mockChargeWalletForVtu.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    rememberPendingVtuPurchase(
      buildVtuPurchaseDescriptor(submitted),
      'stale-data-key'
    );
    notePendingVtuReference(buildVtuPurchaseDescriptor(submitted), reference);
  }

  it('prompts a fresh submit instead of presenting a stale replay as new', async () => {
    const onSuccess = jest.fn();
    const resetWalletIdempotencyKey = jest.fn();
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'processing',
      amount: 1000,
      reference: 'WAL-STALE-DATA',
    });
    await runPurchase({ onSuccess, resetWalletIdempotencyKey });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    seedPendingFromLastCall('WAL-STALE-DATA');

    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(Date.now() + 6 * 60 * 1000);
    try {
      mockChargeWalletForVtu.mockResolvedValueOnce({
        status: 'successful',
        amount: 1000,
        reference: 'WAL-STALE-DATA',
      });
      await runPurchase({ onSuccess, resetWalletIdempotencyKey });
    } finally {
      now.mockRestore();
    }

    expect(Alert.alert).toHaveBeenCalledWith(
      'Purchase Already Completed',
      expect.stringContaining('WAL-STALE-DATA')
    );
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(resetWalletIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it('applies a fresh success normally', async () => {
    const onSuccess = jest.fn();
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'successful',
      amount: 1000,
      reference: 'WAL-FRESH-DATA',
    });
    await runPurchase({ onSuccess });
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'successful',
        reference: 'WAL-FRESH-DATA',
      })
    );
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
