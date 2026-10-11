import { jest } from '@jest/globals';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import {
  buildVtuPurchaseDescriptor,
  notePendingVtuReference,
  rememberPendingVtuPurchase,
} from '@/lib/pending-vtu-idempotency';
import { createBillFormPurchaseHandler } from './create-bill-form-purchase-handler';

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

describe('bill stale success replay', () => {
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
    const handlePurchase = createBillFormPurchaseHandler({
      amount: '1000',
      billType: 'electricity',
      canShowPayment: true,
      customer: null,
      customerId: '1234567890',
      dismissKeyboard: jest.fn(),
      getIsSubmitting: () => false,
      numericAmount: 1000,
      onSuccess: overrides.onSuccess ?? jest.fn(),
      payment: {
        canFundByBankTransfer: false,
        isAuthenticated: true,
        refetchWallet: jest.fn(),
        walletBalance: 5000,
        walletError: null,
        walletIsLoading: false,
        getWalletIdempotencyKey: jest.fn(() => 'stale-bill-key'),
        scopePendingVtuDescriptor: (d: string) => d,
        resetWalletIdempotencyKey:
          overrides.resetWalletIdempotencyKey ?? jest.fn(),
      } as PaymentState,
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
    });
    return handlePurchase();
  }

  it('prompts a fresh submit instead of presenting a stale replay as new', async () => {
    const onSuccess = jest.fn();
    const resetWalletIdempotencyKey = jest.fn();
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'processing',
      amount: 1000,
      reference: 'WAL-STALE-BILL',
    });
    await runPurchase({ onSuccess, resetWalletIdempotencyKey });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    // Seed what the real hook + processing path would have recorded,
    // deriving the descriptor from the actual submitted payload.
    const submitted = mockChargeWalletForVtu.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    rememberPendingVtuPurchase(
      buildVtuPurchaseDescriptor(submitted),
      'stale-bill-key'
    );
    notePendingVtuReference(
      buildVtuPurchaseDescriptor(submitted),
      'WAL-STALE-BILL'
    );

    // The original completed long ago; this identical resubmit is a new
    // intent answered with the old vend.
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(Date.now() + 6 * 60 * 1000);
    try {
      mockChargeWalletForVtu.mockResolvedValueOnce({
        status: 'successful',
        amount: 1000,
        reference: 'WAL-STALE-BILL',
      });
      await runPurchase({ onSuccess, resetWalletIdempotencyKey });
    } finally {
      now.mockRestore();
    }

    expect(Alert.alert).toHaveBeenCalledWith(
      'Purchase Already Completed',
      expect.stringContaining('WAL-STALE-BILL')
    );
    // The old vend is not presented as the new purchase, and the next
    // tap mints a fresh key.
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(resetWalletIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it('applies a fresh success normally', async () => {
    const onSuccess = jest.fn();
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'successful',
      amount: 1000,
      reference: 'WAL-FRESH-BILL',
    });
    await runPurchase({ onSuccess });
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'successful',
        reference: 'WAL-FRESH-BILL',
      })
    );
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
