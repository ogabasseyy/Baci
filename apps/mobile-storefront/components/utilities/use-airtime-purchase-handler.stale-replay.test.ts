import { jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { HttpError } from '@/lib/fetch-with-timeout';
import {
  buildVtuPurchaseDescriptor,
  clearPendingVtuKeys,
  hasNotedPendingVtuReference,
  isStalePendingVtuSuccess,
  markPendingVtuCompleted,
  notePendingVtuReference,
  recallPendingVtuKey,
  PENDING_VTU_STALE_AFTER_MS,
  rememberPendingVtuPurchase,
} from '@/lib/pending-vtu-idempotency';
import { useAirtimePurchaseHandler } from './use-airtime-purchase-handler';

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

describe('airtime stale success replay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Hermetic registry: each test re-seeds its own entries (prior
    // order-dependent assertions leaned on cross-test leftovers).
    clearPendingVtuKeys();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function renderHandler(
    overrides: {
      onSuccess?: jest.Mock;
      resetWalletIdempotencyKey?: jest.Mock;
      isSubmittingOwnerCurrent?: () => boolean;
    } = {}
  ) {
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
          walletBalance: 5000,
          walletError: null,
          walletIsLoading: false,
          // Mirrors the production hook: recall-first, remember only
          // when no entry exists (a blind re-remember would wipe the
          // note/completion the stale guard needs).
          getWalletIdempotencyKey: jest.fn((descriptor: string) => {
            const recalled = recallPendingVtuKey(descriptor);
            if (recalled) return recalled;
            rememberPendingVtuPurchase(descriptor, 'stale-airtime-key');
            return 'stale-airtime-key';
          }),
          scopePendingVtuDescriptor: (d: string) => d,
          captureSubmittingOwner: () => 'test-owner',
          captureSubmittingUserId: () => 'test-user',
          invalidateWallets: jest.fn(),
          isSubmittingOwnerCurrent:
            overrides.isSubmittingOwnerCurrent ?? (() => true),
          resetWalletIdempotencyKey:
            overrides.resetWalletIdempotencyKey ?? jest.fn(),
        } as PaymentState,
        customer: null,
        onSuccess: overrides.onSuccess ?? jest.fn(),
        dismissKeyboard: jest.fn(),
      })
    );
  }

  function seedPendingFromLastCall(reference: string) {
    const submitted = mockChargeWalletForVtu.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    rememberPendingVtuPurchase(
      buildVtuPurchaseDescriptor(submitted),
      'stale-airtime-key'
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
      amount: 500,
      reference: 'WAL-STALE-AIR',
    });
    const first = renderHandler({ onSuccess, resetWalletIdempotencyKey });
    await first.result.current.handlePurchase();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    seedPendingFromLastCall('WAL-STALE-AIR');

    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(Date.now() + 6 * 60 * 1000);
    try {
      mockChargeWalletForVtu.mockResolvedValueOnce({
        status: 'successful',
        amount: 500,
        reference: 'WAL-STALE-AIR',
      });
      // Fresh mount, as after Back to Home + reopen Utilities.
      const second = renderHandler({ onSuccess, resetWalletIdempotencyKey });
      await second.result.current.handlePurchase();
    } finally {
      now.mockRestore();
    }

    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenLastCalledWith(
      expect.objectContaining({ reference: 'WAL-STALE-AIR' })
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
      amount: 500,
      reference: 'WAL-STALE-AIR',
    });
    const first = renderHandler({ onSuccess, resetWalletIdempotencyKey });
    await first.result.current.handlePurchase();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    seedPendingFromLastCall('WAL-STALE-AIR');
    // Completion was observed (as a switched-terminal success would
    // record); the customer returns long after with the same payload.
    const submitted = mockChargeWalletForVtu.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    markPendingVtuCompleted(buildVtuPurchaseDescriptor(submitted));

    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(Date.now() + 6 * 60 * 1000);
    try {
      mockChargeWalletForVtu.mockResolvedValueOnce({
        status: 'successful',
        amount: 500,
        reference: 'WAL-STALE-AIR',
      });
      // Fresh mount, as after Back to Home + reopen Utilities.
      const second = renderHandler({ onSuccess, resetWalletIdempotencyKey });
      await second.result.current.handlePurchase();
    } finally {
      now.mockRestore();
    }

    expect(Alert.alert).toHaveBeenCalledWith(
      'Purchase Already Completed',
      expect.stringContaining('WAL-STALE-AIR')
    );
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(resetWalletIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it('applies a fresh success normally', async () => {
    const onSuccess = jest.fn();
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'successful',
      amount: 500,
      reference: 'WAL-FRESH-AIR',
    });
    const { result } = renderHandler({ onSuccess });
    await result.current.handlePurchase();
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'successful',
        reference: 'WAL-FRESH-AIR',
        customerIdentifier: '08037654321',
      })
    );
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('discards the result when the account switched mid-flight', async () => {
    const onSuccess = jest.fn();
    const resetWalletIdempotencyKey = jest.fn();
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'successful',
      amount: 500,
      reference: 'WAL-SWITCHED-AIR',
    });
    const { result } = renderHandler({
      onSuccess,
      resetWalletIdempotencyKey,
      isSubmittingOwnerCurrent: () => false,
    });
    await result.current.handlePurchase();

    expect(onSuccess).not.toHaveBeenCalled();
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
    expect(isStalePendingVtuSuccess(descriptor, 'WAL-SWITCHED-AIR')).toBe(
      false
    );
    expect(
      isStalePendingVtuSuccess(
        descriptor,
        'WAL-SWITCHED-AIR',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
  });

  it('notes (without completing) a switched processing reference', async () => {
    // The note lands, but no completion is recorded: when the vend
    // resolves minutes later the replay must PRESENT it, not report
    // "Already Completed" (the stale guard keys off completion time).
    const onSuccess = jest.fn();
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'processing',
      amount: 500,
      reference: 'WAL-SWITCH-PROC',
    });
    const { result } = renderHandler({
      onSuccess,
      isSubmittingOwnerCurrent: () => false,
    });
    await result.current.handlePurchase();

    expect(onSuccess).not.toHaveBeenCalled();
    const submitted = mockChargeWalletForVtu.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    const descriptor = buildVtuPurchaseDescriptor(submitted);
    expect(hasNotedPendingVtuReference(descriptor, 'WAL-SWITCH-PROC')).toBe(
      true
    );
    expect(
      isStalePendingVtuSuccess(
        descriptor,
        'WAL-SWITCH-PROC',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(false);

    // Switch-back replay minutes later: first completion presents.
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(Date.now() + 6 * 60 * 1000);
    try {
      mockChargeWalletForVtu.mockResolvedValueOnce({
        status: 'successful',
        amount: 500,
        reference: 'WAL-SWITCH-PROC',
      });
      const second = renderHandler({ onSuccess });
      await second.result.current.handlePurchase();
    } finally {
      now.mockRestore();
    }

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'WAL-SWITCH-PROC' })
    );
    expect(Alert.alert).not.toHaveBeenCalledWith(
      'Purchase Already Completed',
      expect.anything()
    );
  });

  it('rotates the idempotency key on a terminal 4xx even when the account switched', async () => {
    // The submitter's retained key would replay the dead
    // transaction when they retry — finalize it for the submitter
    // even though the result UI is discarded.
    mockChargeWalletForVtu.mockRejectedValueOnce(
      new HttpError(400, 'Insufficient funds')
    );
    const resetWalletIdempotencyKey = jest.fn();
    const { result } = renderHandler({
      resetWalletIdempotencyKey,
      isSubmittingOwnerCurrent: () => false,
    });

    await result.current.handlePurchase();

    expect(resetWalletIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it('keeps the idempotency key on a pre-route 429 when the account switched', async () => {
    mockChargeWalletForVtu.mockRejectedValueOnce(
      new HttpError(429, 'Too many requests')
    );
    const resetWalletIdempotencyKey = jest.fn();
    const { result } = renderHandler({
      resetWalletIdempotencyKey,
      isSubmittingOwnerCurrent: () => false,
    });

    await result.current.handlePurchase();

    expect(resetWalletIdempotencyKey).not.toHaveBeenCalled();
  });
});
