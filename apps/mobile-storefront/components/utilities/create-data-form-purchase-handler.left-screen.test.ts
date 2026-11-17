import { jest } from '@jest/globals';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { createDataFormPurchaseHandler } from './create-data-form-purchase-handler';

type PaymentState = ReturnType<typeof useUtilityPayment>;

const mockChargeWalletForVtu =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockPayFromPiggyvest =
  jest.fn<(...args: unknown[]) => Promise<boolean>>();

jest.mock('@/lib/vtu-checkout', () => ({
  ...jest.requireActual<typeof import('@/lib/vtu-checkout')>(
    '@/lib/vtu-checkout'
  ),
  chargeWalletForVtu: (...args: unknown[]) => mockChargeWalletForVtu(...args),
}));
jest.mock('@/hooks/use-vtu-retained-settlement', () => ({
  getPendingVtuSettlementPass: () => null,
}));
jest.mock('@/lib/utility-wallet-readiness', () => ({
  ensureUtilityWalletReady: jest.fn(() => true),
}));
jest.mock('./vtu-wallet-pay-store', () => ({
  payFromPiggyvest: (...args: unknown[]) => mockPayFromPiggyvest(...args),
}));

describe('bugfix: leaving the screen during the retained-key lookup (Codex P2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('charges no store credit when the screen is gone after the lookup', async () => {
    let active = true;
    mockPayFromPiggyvest.mockImplementation(async () => {
      // The customer leaves while the lookup runs; nothing was handed over.
      active = false;
      return false;
    });
    const setIsSubmitting = jest.fn();
    const handlePurchase = createDataFormPurchaseHandler({
      customer: null,
      dismissKeyboard: jest.fn(),
      getIsActive: () => active,
      getIsSubmitting: () => false,
      onSuccess: jest.fn(),
      payment: {
        canFundByBankTransfer: false,
        isAuthenticated: true,
        refetchWallet: jest.fn(),
        getWalletBalance: () => 5000,
        walletError: null,
        walletIsLoading: false,
        isWalletRefetching: () => false,
        isWalletSettled: () => true,
        getWalletError: () => null,
        getWalletIdempotencyKey: jest.fn(async () => 'key'),
        scopePendingVtuDescriptor: (d: string) => d,
        captureSubmittingOwner: () => 'owner',
        captureSubmittingUserId: () => 'user',
        invalidateWallets: jest.fn(),
        isSubmittingOwnerCurrent: () => true,
        resetWalletIdempotencyKey: jest.fn(),
        hasRetainedVtuAttempt: jest.fn(() => false),
      } as PaymentState,
      phoneNumber: '08031234567',
      planAmount: 1000,
      selectedPlan: 'MTN-DATA-1GB',
      selectedProvider: 'mtn',
      setIsSubmitting,
    });

    await handlePurchase();

    expect(mockPayFromPiggyvest).toHaveBeenCalledTimes(1);
    expect(mockChargeWalletForVtu).not.toHaveBeenCalled();
    expect(setIsSubmitting).toHaveBeenLastCalledWith(false);
  });
});
