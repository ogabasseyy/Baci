import { jest } from '@jest/globals';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { HttpError } from '@/lib/fetch-with-timeout';
import { buildVtuPurchaseDescriptor } from '@/lib/pending-vtu-descriptor';
import {
  clearPendingVtuKeys,
  isStalePendingVtuSuccess,
  markPendingVtuCompleted,
  notePendingVtuReference,
  PENDING_VTU_STALE_AFTER_MS,
  recallPendingVtuKey,
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
    // Hermetic registry: each test re-seeds its own entries.
    clearPendingVtuKeys();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function runPurchase(
    overrides: {
      onSuccess?: jest.Mock;
      resetWalletIdempotencyKey?: jest.Mock;
      refetchWallet?: jest.Mock;
      invalidateWallets?: jest.Mock;
      isSubmittingOwnerCurrent?: () => boolean;
      getIsActive?: () => boolean;
    } = {}
  ) {
    const handlePurchase = createBillFormPurchaseHandler({
      amount: '1000',
      billType: 'electricity',
      canShowPayment: true,
      customer: null,
      customerId: '1234567890',
      dismissKeyboard: jest.fn(),
      getIsActive: overrides.getIsActive,
      getIsSubmitting: () => false,
      numericAmount: 1000,
      onSuccess: overrides.onSuccess ?? jest.fn(),
      payment: {
        canFundByBankTransfer: false,
        isAuthenticated: true,
        refetchWallet: overrides.refetchWallet ?? jest.fn(),
        walletBalance: 5000,
        walletError: null,
        walletIsLoading: false,
        // Mirrors the production hook: recall-first, remember only
        // when no entry exists (a blind re-remember would wipe the
        // note/completion the stale guard needs).
        getWalletIdempotencyKey: jest.fn((descriptor: string) => {
          const recalled = recallPendingVtuKey(descriptor);
          if (recalled) return recalled;
          rememberPendingVtuPurchase(descriptor, 'stale-bill-key');
          return 'stale-bill-key';
        }),
        scopePendingVtuDescriptor: (d: string) => d,
        captureSubmittingOwner: () => 'test-owner',
        captureSubmittingUserId: () => 'test-user',
        invalidateWallets: overrides.invalidateWallets ?? jest.fn(),
        isSubmittingOwnerCurrent:
          overrides.isSubmittingOwnerCurrent ?? (() => true),
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

  function seedPendingFromLastCall(reference: string) {
    const submitted = mockChargeWalletForVtu.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    rememberPendingVtuPurchase(
      buildVtuPurchaseDescriptor(submitted),
      'stale-bill-key'
    );
    notePendingVtuReference(buildVtuPurchaseDescriptor(submitted), reference);
  }

  it('presents a slow first completion instead of already-completed', async () => {
    // Staleness keys off OBSERVED completion, not the submit: a 202
    // noted early and completed minutes later must present the vend.
    const onSuccess = jest.fn();
    const resetWalletIdempotencyKey = jest.fn();
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'processing',
      amount: 1000,
      reference: 'WAL-STALE-BILL',
    });
    await runPurchase({ onSuccess, resetWalletIdempotencyKey });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    seedPendingFromLastCall('WAL-STALE-BILL');

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

    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenLastCalledWith(
      expect.objectContaining({ reference: 'WAL-STALE-BILL' })
    );
    expect(Alert.alert).not.toHaveBeenCalledWith(
      'Purchase Already Completed',
      expect.anything()
    );
  });

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
    // Completion was observed (as a switched-terminal success would
    // record); the customer returns long after with the same payload.
    markPendingVtuCompleted(buildVtuPurchaseDescriptor(submitted));

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

  it('discards the result when the account switched mid-flight', async () => {
    const onSuccess = jest.fn();
    const resetWalletIdempotencyKey = jest.fn();
    const refetchWallet = jest.fn();
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'successful',
      amount: 1000,
      reference: 'WAL-SWITCHED-BILL',
    });
    await runPurchase({
      onSuccess,
      resetWalletIdempotencyKey,
      refetchWallet,
      isSubmittingOwnerCurrent: () => false,
    });

    expect(onSuccess).not.toHaveBeenCalled();
    // The charge committed but onSuccess is suppressed: the wallet
    // must still refresh so the balance is not stale on return.
    expect(refetchWallet).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Account Changed',
      expect.stringContaining('changed while the purchase was processing')
    );
    // Switched terminal success is PRESERVED (not reset): the
    // submitter's switch-back repeat must replay the original outcome,
    // not mint fresh and debit twice.
    expect(resetWalletIdempotencyKey).not.toHaveBeenCalled();
    const submitted = mockChargeWalletForVtu.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    const descriptor = buildVtuPurchaseDescriptor(submitted);
    expect(isStalePendingVtuSuccess(descriptor, 'WAL-SWITCHED-BILL')).toBe(
      false
    );
    expect(
      isStalePendingVtuSuccess(
        descriptor,
        'WAL-SWITCHED-BILL',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
  });

  it('preserves an off-screen success for replay instead of resetting', async () => {
    const onSuccess = jest.fn();
    const resetWalletIdempotencyKey = jest.fn();
    const refetchWallet = jest.fn();
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'successful',
      amount: 1000,
      reference: 'WAL-OFFSCREEN-BILL',
    });
    await runPurchase({
      onSuccess,
      resetWalletIdempotencyKey,
      refetchWallet,
      getIsActive: () => false,
    });

    // Back-navigated mid-flight: no UI on the gone screen, and the key
    // is PRESERVED — a reset here would mint fresh on reopen and debit
    // twice.
    expect(onSuccess).not.toHaveBeenCalled();
    expect(resetWalletIdempotencyKey).not.toHaveBeenCalled();
    // The suppressed onSuccess never fires the parent's wallet
    // invalidation: refresh here so the balance is current.
    expect(refetchWallet).toHaveBeenCalledTimes(1);
    const submitted = mockChargeWalletForVtu.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    const descriptor = buildVtuPurchaseDescriptor(submitted);
    expect(isStalePendingVtuSuccess(descriptor, 'WAL-OFFSCREEN-BILL')).toBe(
      false
    );
    expect(
      isStalePendingVtuSuccess(
        descriptor,
        'WAL-OFFSCREEN-BILL',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);

    // Reopen replay: SAME key, original outcome presented.
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'successful',
      amount: 1000,
      reference: 'WAL-OFFSCREEN-BILL',
    });
    await runPurchase({ onSuccess, resetWalletIdempotencyKey });
    const replayed = mockChargeWalletForVtu.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(replayed.idempotencyKey).toBe('stale-bill-key');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'WAL-OFFSCREEN-BILL' })
    );
  });

  it('finalizes but suppresses an off-screen terminal rejection', async () => {
    // Rotation + refetch must still run (the dead key must not replay
    // when the customer retries), but no failure UI may fire over the
    // destination screen.
    mockChargeWalletForVtu.mockRejectedValueOnce(
      new HttpError(400, 'Insufficient funds')
    );
    const resetWalletIdempotencyKey = jest.fn();
    const refetchWallet = jest.fn();
    await runPurchase({
      resetWalletIdempotencyKey,
      refetchWallet,
      getIsActive: () => false,
    });

    expect(resetWalletIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(refetchWallet).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('refreshes the wallet on an off-screen ambiguous rejection without rotating', async () => {
    mockChargeWalletForVtu.mockRejectedValueOnce(
      new HttpError(500, 'Gateway error')
    );
    const resetWalletIdempotencyKey = jest.fn();
    const refetchWallet = jest.fn();
    await runPurchase({
      resetWalletIdempotencyKey,
      refetchWallet,
      getIsActive: () => false,
    });

    expect(resetWalletIdempotencyKey).not.toHaveBeenCalled();
    // The 5xx may have committed while its response was lost: refresh
    // so reopening does not validate against the pre-debit balance
    // (Codex R55 6rrMIb). Rotation stays off (ambiguous keeps the
    // key) and no Alert may fire over the destination screen.
    expect(refetchWallet).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('suppresses the switch alert but still invalidates when off-screen', async () => {
    // Navigated away AND switched accounts mid-flight: the discard +
    // invalidate still run, but no Alert may fire over the new screen.
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'successful',
      amount: 1000,
      reference: 'WAL-SWITCH-OFFSCREEN-BILL',
    });
    const onSuccess = jest.fn();
    const resetWalletIdempotencyKey = jest.fn();
    const invalidateWallets = jest.fn();
    await runPurchase({
      onSuccess,
      resetWalletIdempotencyKey,
      invalidateWallets,
      isSubmittingOwnerCurrent: () => false,
      getIsActive: () => false,
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(invalidateWallets).toHaveBeenCalledTimes(1);
    expect(resetWalletIdempotencyKey).not.toHaveBeenCalled();
    const submitted = mockChargeWalletForVtu.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    const descriptor = buildVtuPurchaseDescriptor(submitted);
    expect(
      isStalePendingVtuSuccess(
        descriptor,
        'WAL-SWITCH-OFFSCREEN-BILL',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
  });
});
