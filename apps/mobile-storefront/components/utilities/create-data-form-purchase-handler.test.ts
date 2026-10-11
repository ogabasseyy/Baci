import { jest } from '@jest/globals';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
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

describe('data form purchase cashback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function runPurchase(onSuccess: jest.Mock) {
    const handlePurchase = createDataFormPurchaseHandler({
      customer: null,
      dismissKeyboard: jest.fn(),
      getIsSubmitting: () => false,
      onSuccess,
      payment: {
        canFundByBankTransfer: false,
        isAuthenticated: true,
        refetchWallet: jest.fn(),
        walletBalance: 5000,
        walletError: null,
        walletIsLoading: false,
        getWalletIdempotencyKey: jest.fn(() => 'data-key'),
        scopePendingVtuDescriptor: (d: string) => d,
        captureSubmittingOwner: () => 'test-owner',
        captureSubmittingUserId: () => 'test-user',
        invalidateWallets: jest.fn(),
        isSubmittingOwnerCurrent: () => true,
        resetWalletIdempotencyKey: jest.fn(),
      } as PaymentState,
      phoneNumber: '08031234567',
      planAmount: 1000,
      selectedPlan: 'MTN-DATA-1GB',
      selectedProvider: 'mtn',
      setIsSubmitting: jest.fn(),
    });
    return handlePurchase();
  }

  it('passes through cashback the server credited', async () => {
    mockChargeWalletForVtu.mockResolvedValueOnce({
      amount: 1000,
      cashback: { amount: 50, credited: true, newBalance: 4050 },
      reference: 'REF-CB',
      status: 'successful',
    });
    const onSuccess = jest.fn();

    await runPurchase(onSuccess);

    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        cashback: { amount: 50, newBalance: 4050 },
      })
    );
  });

  it('suppresses cashback the server did not credit', async () => {
    mockChargeWalletForVtu.mockResolvedValueOnce({
      amount: 1000,
      cashback: { amount: 50, credited: false, newBalance: 0 },
      reference: 'REF-NOCB',
      status: 'successful',
    });
    const onSuccess = jest.fn();

    await runPurchase(onSuccess);

    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ cashback: undefined })
    );
  });
});
