import { jest } from '@jest/globals';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { HttpError } from '@/lib/fetch-with-timeout';
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

  function runPurchase(
    onSuccess: jest.Mock,
    overrides: {
      isSubmittingOwnerCurrent?: () => boolean;
      resetWalletIdempotencyKey?: jest.Mock;
      refetchWallet?: jest.Mock;
      invalidateWallets?: jest.Mock;
    } = {}
  ) {
    const handlePurchase = createDataFormPurchaseHandler({
      customer: null,
      dismissKeyboard: jest.fn(),
      getIsSubmitting: () => false,
      onSuccess,
      payment: {
        canFundByBankTransfer: false,
        isAuthenticated: true,
        refetchWallet: overrides.refetchWallet ?? jest.fn(),
        walletBalance: 5000,
        walletError: null,
        walletIsLoading: false,
        getWalletIdempotencyKey: jest.fn(() => 'data-key'),
        scopePendingVtuDescriptor: (d: string) => d,
        captureSubmittingOwner: () => 'test-owner',
        captureSubmittingUserId: () => 'test-user',
        invalidateWallets: overrides.invalidateWallets ?? jest.fn(),
        isSubmittingOwnerCurrent:
          overrides.isSubmittingOwnerCurrent ?? (() => true),
        resetWalletIdempotencyKey:
          overrides.resetWalletIdempotencyKey ?? jest.fn(),
        hasRetainedVtuAttempt: jest.fn(() => false),
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

  it('rotates the idempotency key on a terminal 4xx even when the account switched', async () => {
    // The submitter's retained key would replay the dead
    // transaction when they retry — finalize it for the submitter
    // even though the result UI is discarded.
    mockChargeWalletForVtu.mockRejectedValueOnce(
      new HttpError(400, 'Insufficient funds')
    );
    const resetWalletIdempotencyKey = jest.fn();
    const refetchWallet = jest.fn();
    const invalidateWallets = jest.fn();

    await runPurchase(jest.fn(), {
      isSubmittingOwnerCurrent: () => false,
      resetWalletIdempotencyKey,
      refetchWallet,
      invalidateWallets,
    });

    expect(resetWalletIdempotencyKey).toHaveBeenCalledTimes(1);
    // The switch helper invalidates all cached wallets for the retry.
    expect(invalidateWallets).toHaveBeenCalledTimes(1);
    expect(refetchWallet).not.toHaveBeenCalled();
  });

  it('keeps the idempotency key on a pre-route 429 when the account switched', async () => {
    mockChargeWalletForVtu.mockRejectedValueOnce(
      new HttpError(429, 'Too many requests')
    );
    const resetWalletIdempotencyKey = jest.fn();
    const refetchWallet = jest.fn();
    const invalidateWallets = jest.fn();

    await runPurchase(jest.fn(), {
      isSubmittingOwnerCurrent: () => false,
      resetWalletIdempotencyKey,
      refetchWallet,
      invalidateWallets,
    });

    expect(resetWalletIdempotencyKey).not.toHaveBeenCalled();
    expect(refetchWallet).not.toHaveBeenCalled();
    // The switch itself still invalidates (via the switch helper).
    expect(invalidateWallets).toHaveBeenCalledTimes(1);
  });

  it('refetches the wallet when a terminal 4xx rejects the purchase', async () => {
    mockChargeWalletForVtu.mockRejectedValueOnce(
      new HttpError(400, 'Insufficient funds')
    );
    const refetchWallet = jest.fn();
    const invalidateWallets = jest.fn();

    await runPurchase(jest.fn(), { refetchWallet, invalidateWallets });

    expect(refetchWallet).toHaveBeenCalledTimes(1);
    expect(invalidateWallets).not.toHaveBeenCalled();
  });

  it('waits for the wallet refetch before surfacing the rejection', async () => {
    // Fire-and-forget would let a quick retry re-pass readiness on
    // the stale balance: the alert must come after refetch-done.
    mockChargeWalletForVtu.mockRejectedValueOnce(
      new HttpError(400, 'Insufficient funds')
    );
    const order: string[] = [];
    let resolveRefetch!: () => void;
    const refetchGate = new Promise<void>((resolve) => {
      resolveRefetch = resolve;
    });
    const refetchWallet = jest.fn(() => {
      order.push('refetch-start');
      return refetchGate.then(() => {
        order.push('refetch-done');
      });
    });
    jest.mocked(Alert.alert).mockImplementation(() => {
      order.push('alert');
    });

    const pending = runPurchase(jest.fn(), { refetchWallet });
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual(['refetch-start']);
    resolveRefetch();
    await pending;
    expect(order).toEqual(['refetch-start', 'refetch-done', 'alert']);
  });
});
