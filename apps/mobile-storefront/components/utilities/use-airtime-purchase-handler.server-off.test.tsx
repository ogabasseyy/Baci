import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { useAirtimePurchaseHandler } from './use-airtime-purchase-handler';
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
jest.mock('@/hooks/use-vtu-retained-settlement', () => ({
  getPendingVtuSettlementPass: () => null,
}));
jest.mock('@/lib/utility-wallet-readiness', () => ({
  ensureUtilityWalletReady: jest.fn(() => true),
}));

function renderHandler() {
  return renderHook(() =>
    useAirtimePurchaseHandler({
      amount: '500',
      numericAmount: 500,
      phoneNumber: '08037654321',
      selectedProvider: 'mtn',
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
        getWalletIdempotencyKey: jest.fn(async () => 'airtime-key'),
        scopePendingVtuDescriptor: (d: string) => d,
        captureSubmittingOwner: () => 'owner',
        captureSubmittingUserId: () => 'user',
        invalidateWallets: jest.fn(),
        isSubmittingOwnerCurrent: () => true,
        resetWalletIdempotencyKey: jest.fn(),
        hasRetainedVtuAttempt: jest.fn(() => false),
      } as PaymentState,
      customer: null,
      onSuccess: jest.fn(),
      dismissKeyboard: jest.fn(),
    })
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  useVtuWalletPayStore.setState({ covers: () => false, pending: null });
  mockChargeWalletForVtu.mockResolvedValue({
    amount: 500,
    reference: 'REF',
    status: 'successful',
  });
});

describe('airtime purchase with the server keeping PiggyVest off', () => {
  it('pays from store credit exactly as before', async () => {
    const hook = renderHandler();
    await act(async () => {
      await hook.result.current.handlePurchase();
    });
    expect(mockChargeWalletForVtu).toHaveBeenCalledTimes(1);
    expect(useVtuWalletPayStore.getState().pending).toBeNull();
  });

  it('hands the purchase to the PiggyVest sheet only once it covers it', async () => {
    useVtuWalletPayStore.setState({ covers: () => true });
    const hook = renderHandler();
    await act(async () => {
      await hook.result.current.handlePurchase();
    });
    expect(mockChargeWalletForVtu).not.toHaveBeenCalled();
    expect(useVtuWalletPayStore.getState().pending?.request).toMatchObject({
      amount: 500,
      type: 'airtime',
    });
  });
});
