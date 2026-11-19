import { jest } from '@jest/globals';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { createDataFormPurchaseHandler } from './create-data-form-purchase-handler';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

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
jest.mock('@/hooks/use-vtu-retained-settlement', () => ({
  getPendingVtuSettlementPass: () => null,
}));

function runPurchase() {
  return createDataFormPurchaseHandler({
    customer: null,
    dismissKeyboard: jest.fn(),
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
      getWalletIdempotencyKey: jest.fn(async () => 'data-key'),
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
    setIsSubmitting: jest.fn(),
  })();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  useVtuWalletPayStore.setState({ covers: () => false, pending: null });
  mockChargeWalletForVtu.mockResolvedValue({
    amount: 1000,
    reference: 'REF',
    status: 'successful',
  });
});

describe('data purchase with the server keeping PiggyVest off', () => {
  it('pays from store credit exactly as before', async () => {
    await runPurchase();
    expect(mockChargeWalletForVtu).toHaveBeenCalledTimes(1);
    expect(useVtuWalletPayStore.getState().pending).toBeNull();
  });

  it('hands the purchase to the PiggyVest sheet only once it covers it', async () => {
    useVtuWalletPayStore.setState({ covers: () => true });
    await runPurchase();
    expect(mockChargeWalletForVtu).not.toHaveBeenCalled();
    expect(useVtuWalletPayStore.getState().pending?.request).toMatchObject({
      amount: 1000,
      type: 'data',
    });
  });
});
