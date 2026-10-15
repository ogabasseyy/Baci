import { jest } from '@jest/globals';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { HttpError } from '@/lib/fetch-with-timeout';
import {
  releaseUtilityCheckout,
  tryAcquireUtilityCheckout,
} from '@/lib/utility-checkout-inflight';
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

const mockGetSettlementPass = jest.fn<() => Promise<void> | null>();

jest.mock('@/hooks/use-vtu-retained-settlement', () => ({
  getPendingVtuSettlementPass: () => mockGetSettlementPass(),
}));

describe('data form purchase cashback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettlementPass.mockReturnValue(null);
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
        getWalletBalance: () => 5000,
        walletError: null,
        walletIsLoading: false,
        isWalletRefetching: () => false,
        isWalletSettled: () => true,
        getWalletError: () => null,
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

  it('does not charge when the account switches during the settlement gate', async () => {
    // Codex R103 P2: same fence as the airtime handler — a switch
    // during the pass must not submit the previous owner's peeked
    // attempt under the replacement session.
    let release!: () => void;
    mockGetSettlementPass.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const pending = runPurchase(jest.fn(), {
      isSubmittingOwnerCurrent: () => false,
    });
    release();
    await pending;
    expect(mockChargeWalletForVtu).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Account Changed',
      'The signed-in account changed while the purchase was starting. Please try again.'
    );
  });
});

describe('data form purchase checkout guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettlementPass.mockReturnValue(null);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    releaseUtilityCheckout();
  });

  function runGuardedPurchase(setIsSubmitting: jest.Mock) {
    const handlePurchase = createDataFormPurchaseHandler({
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
        getWalletIdempotencyKey: jest.fn(() => 'data-key'),
        scopePendingVtuDescriptor: (d: string) => d,
        captureSubmittingOwner: () => 'test-owner',
        captureSubmittingUserId: () => 'test-user',
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
    return handlePurchase();
  }

  it('refuses a second concurrent checkout without charging', async () => {
    // Codex R77 6sNGO3: a submit on another tab while this checkout
    // is in flight must refuse (Alert) and never reach charge — the
    // first success unmounts the pager and would strand its receipt.
    expect(tryAcquireUtilityCheckout()).toBe(true);
    try {
      const setIsSubmitting = jest.fn();

      await runGuardedPurchase(setIsSubmitting);

      expect(mockChargeWalletForVtu).not.toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenCalledWith(
        'Checkout in progress',
        expect.any(String)
      );
      expect(setIsSubmitting).toHaveBeenLastCalledWith(false);
    } finally {
      releaseUtilityCheckout();
    }
  });

  it('releases the guard when the checkout settles', async () => {
    mockChargeWalletForVtu.mockResolvedValueOnce({
      amount: 1000,
      reference: 'REF-G',
      status: 'successful',
    });

    await runGuardedPurchase(jest.fn());

    expect(tryAcquireUtilityCheckout()).toBe(true);
  });
});
