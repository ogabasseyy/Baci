import { jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { HttpError } from '@/lib/fetch-with-timeout';
import {
  buildVtuPurchaseDescriptor,
  isStalePendingVtuSuccess,
  notePendingVtuReference,
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
          getWalletIdempotencyKey: jest.fn(() => 'stale-airtime-key'),
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
    // Terminal success finalizes the submitter's entry: repeat mints fresh.
    expect(resetWalletIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it('notes the processing reference when the account switched mid-flight', async () => {
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
    expect(
      isStalePendingVtuSuccess(
        buildVtuPurchaseDescriptor(submitted),
        'WAL-SWITCH-PROC',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
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
