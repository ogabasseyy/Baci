import { jest } from '@jest/globals';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { clearPendingVtuKeys } from '@/lib/pending-vtu-idempotency';
import { createBillFormPurchaseHandler } from './create-bill-form-purchase-handler';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

type PaymentState = ReturnType<typeof useUtilityPayment>;
type PurchaseHandlerOptions = Parameters<
  typeof createBillFormPurchaseHandler
>[0];
type PurchaseHandlerOverrides = Omit<
  Partial<PurchaseHandlerOptions>,
  'payment'
> & {
  payment?: Partial<PurchaseHandlerOptions['payment']>;
};

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

const mockGetSettlementPass = jest.fn<() => Promise<void> | null>();

jest.mock('@/hooks/use-vtu-retained-settlement', () => ({
  getPendingVtuSettlementPass: () => mockGetSettlementPass(),
}));

function createPaymentState(
  overrides: Partial<PaymentState> = {}
): PaymentState {
  return {
    canFundByBankTransfer: false,
    isAuthenticated: true,
    refetchWallet: jest.fn(() => Promise.resolve(undefined)),
    getWalletBalance: () => 5000,
    walletError: null,
    walletIsLoading: false,
    isWalletRefetching: () => false,
    isWalletSettled: () => true,
    getWalletError: () => null,
    getWalletIdempotencyKey: jest.fn(async () => 'test-key'),
    scopePendingVtuDescriptor: (d: string) => d,
    captureSubmittingOwner: () => 'test-owner',
    captureSubmittingUserId: () => 'test-user',
    invalidateWallets: jest.fn(),
    isSubmittingOwnerCurrent: () => true,
    resetWalletIdempotencyKey: jest.fn(),
    hasRetainedVtuAttempt: jest.fn(() => false),
    ...overrides,
  };
}

function createValidHandler(overrides: PurchaseHandlerOverrides = {}) {
  const defaults: PurchaseHandlerOptions = {
    amount: '1000',
    billType: 'electricity',
    canShowPayment: true,
    customer: null,
    customerId: '1234567890',
    dismissKeyboard: jest.fn(),
    getIsSubmitting: () => false,
    numericAmount: 1000,
    onSuccess: jest.fn(),
    payment: createPaymentState(),
    selectedBiller: {
      billerId: 'ekedc',
      billerName: 'EKEDC NG',
      billerType: 'Electricity',
      categoryId: 'electricity',
      categoryName: 'Electricity',
    },
    selectedBillItem: null,
    selectedBillItemIdentifier: 'postpaid',
    selectedBillItemPathLabel: 'Postpaid',
    setIsSubmitting: jest.fn(),
    type: 'power',
    verifiedCustomerName: null,
    verifiedCustomerAddress: null,
  };

  return createBillFormPurchaseHandler({
    ...defaults,
    ...overrides,
    payment: {
      ...defaults.payment,
      ...overrides.payment,
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearPendingVtuKeys();
  mockGetSettlementPass.mockReturnValue(null);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  useVtuWalletPayStore.setState({ covers: () => false, pending: null });
  mockChargeWalletForVtu.mockResolvedValue({
    status: 'successful',
    amount: 1000,
    reference: 'WAL-1',
  });
});

describe('bill purchase with the server keeping PiggyVest off', () => {
  it('pays from store credit exactly as before', async () => {
    await createValidHandler()();
    expect(mockChargeWalletForVtu).toHaveBeenCalledTimes(1);
    expect(useVtuWalletPayStore.getState().pending).toBeNull();
  });

  it('hands the bill to the PiggyVest sheet only once it covers it', async () => {
    useVtuWalletPayStore.setState({ covers: () => true });
    await createValidHandler()();
    expect(mockChargeWalletForVtu).not.toHaveBeenCalled();
    expect(useVtuWalletPayStore.getState().pending?.request).toMatchObject({
      amount: 1000,
      type: 'electricity',
    });
  });
});
