import { jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { HttpError } from '@/lib/fetch-with-timeout';
import { buildVtuPurchaseDescriptor } from '@/lib/pending-vtu-descriptor';
import {
  clearPendingVtuKeys,
  hasNotedPendingVtuReference,
  isStalePendingVtuSuccess,
  markPendingVtuCompleted,
  notePendingVtuReference,
  PENDING_VTU_STALE_AFTER_MS,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from '@/lib/pending-vtu-idempotency';
import {
  releaseUtilityCheckout,
  tryAcquireUtilityCheckout,
} from '@/lib/utility-checkout-inflight';
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

const mockGetSettlementPass = jest.fn<() => Promise<void> | null>();

jest.mock('@/hooks/use-vtu-retained-settlement', () => ({
  getPendingVtuSettlementPass: () => mockGetSettlementPass(),
}));

jest.mock('@/lib/utility-wallet-readiness', () => ({
  ensureUtilityWalletReady: jest.fn(() => true),
}));

describe('airtime stale success replay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettlementPass.mockReturnValue(null);
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
      refetchWallet?: jest.Mock;
      invalidateWallets?: jest.Mock;
      isSubmittingOwnerCurrent?: () => boolean;
      getIsActive?: () => boolean;
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
          refetchWallet: overrides.refetchWallet ?? jest.fn(),
          getWalletBalance: () => 5000,
          walletError: null,
          walletIsLoading: false,
          isWalletRefetching: () => false,
          isWalletSettled: () => true,
          getWalletError: () => null,
          // Mirrors the production hook: recall-first, remember only
          // when no entry exists (a blind re-remember would wipe the
          // note/completion the stale guard needs).
          getWalletIdempotencyKey: jest.fn(async (descriptor: string) => {
            const recalled = recallPendingVtuKey(descriptor);
            if (recalled) return recalled;
            rememberPendingVtuPurchase(descriptor, 'stale-airtime-key');
            return 'stale-airtime-key';
          }),
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
        customer: null,
        onSuccess: overrides.onSuccess ?? jest.fn(),
        dismissKeyboard: jest.fn(),
        getIsActive: overrides.getIsActive,
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
    const refetchWallet = jest.fn();
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'successful',
      amount: 500,
      reference: 'WAL-SWITCHED-AIR',
    });
    const { result } = renderHandler({
      onSuccess,
      resetWalletIdempotencyKey,
      refetchWallet,
      isSubmittingOwnerCurrent: () => false,
    });
    await result.current.handlePurchase();

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

  it('keeps a switched success out of Payment Failed when the wallet refetch rejects', async () => {
    const onSuccess = jest.fn();
    const refetchWallet = jest.fn(() =>
      Promise.reject(new Error('wallet query exploded'))
    );
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'successful',
      amount: 500,
      reference: 'WAL-SWITCHED-REJECT',
    });
    const { result } = renderHandler({
      onSuccess,
      refetchWallet,
      isSubmittingOwnerCurrent: () => false,
    });
    await result.current.handlePurchase();

    expect(onSuccess).not.toHaveBeenCalled();
    expect(refetchWallet).toHaveBeenCalledTimes(1);
    // The committed success must not surface as a failure: only the
    // account-switch notice may appear, never `Payment Failed`.
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Account Changed',
      expect.stringContaining('changed while the purchase was processing')
    );
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
    const refetchWallet = jest.fn();
    const invalidateWallets = jest.fn();
    const { result } = renderHandler({
      resetWalletIdempotencyKey,
      refetchWallet,
      invalidateWallets,
      isSubmittingOwnerCurrent: () => false,
    });

    await result.current.handlePurchase();

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
    const { result } = renderHandler({
      resetWalletIdempotencyKey,
      refetchWallet,
      invalidateWallets,
      isSubmittingOwnerCurrent: () => false,
    });

    await result.current.handlePurchase();

    expect(resetWalletIdempotencyKey).not.toHaveBeenCalled();
    expect(refetchWallet).not.toHaveBeenCalled();
    // The switch itself still invalidates (via the switch helper).
    expect(invalidateWallets).toHaveBeenCalledTimes(1);
  });

  it('refetches the wallet when a terminal 4xx rejects the purchase', async () => {
    // The rejection may prove a stale balance: refetch now so the
    // next tap's readiness check sees the real balance instead of
    // passing on the cached sufficient one and failing again.
    mockChargeWalletForVtu.mockRejectedValueOnce(
      new HttpError(400, 'Insufficient funds')
    );
    const refetchWallet = jest.fn();
    const invalidateWallets = jest.fn();
    const { result } = renderHandler({ refetchWallet, invalidateWallets });

    await result.current.handlePurchase();

    expect(refetchWallet).toHaveBeenCalledTimes(1);
    expect(invalidateWallets).not.toHaveBeenCalled();
  });

  it('waits for the wallet refetch before surfacing the rejection', async () => {
    // Fire-and-forget would let a quick retry re-pass readiness on
    // the stale balance (`walletIsLoading` is false during
    // background refetches): the alert must come after refetch-done.
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
    const { result } = renderHandler({ refetchWallet });

    const pending = result.current.handlePurchase();
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual(['refetch-start']);
    resolveRefetch();
    await pending;
    expect(order).toEqual(['refetch-start', 'refetch-done', 'alert']);
  });

  it('preserves an off-screen success for replay instead of resetting', async () => {
    const onSuccess = jest.fn();
    const resetWalletIdempotencyKey = jest.fn();
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'successful',
      amount: 500,
      reference: 'WAL-OFFSCREEN-AIR',
    });
    const refetchWallet = jest.fn();
    const { result } = renderHandler({
      onSuccess,
      resetWalletIdempotencyKey,
      refetchWallet,
      getIsActive: () => false,
    });
    await result.current.handlePurchase();

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
    expect(isStalePendingVtuSuccess(descriptor, 'WAL-OFFSCREEN-AIR')).toBe(
      false
    );
    expect(
      isStalePendingVtuSuccess(
        descriptor,
        'WAL-OFFSCREEN-AIR',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);

    // Reopen replay: SAME key, original outcome presented.
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'successful',
      amount: 500,
      reference: 'WAL-OFFSCREEN-AIR',
    });
    const second = renderHandler({ onSuccess, resetWalletIdempotencyKey });
    await second.result.current.handlePurchase();
    const replayed = mockChargeWalletForVtu.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(replayed.idempotencyKey).toBe('stale-airtime-key');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'WAL-OFFSCREEN-AIR' })
    );
  });

  it('preserves success when the screen unmounts mid-flight', async () => {
    // Default wiring (no injected probe): the hook's own mount state
    // drives the guard.
    const onSuccess = jest.fn();
    const resetWalletIdempotencyKey = jest.fn();
    let resolveCharge!: (value: unknown) => void;
    mockChargeWalletForVtu.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCharge = resolve;
      })
    );
    const refetchWallet = jest.fn();
    const { result, unmount } = renderHandler({
      onSuccess,
      resetWalletIdempotencyKey,
      refetchWallet,
    });
    const purchase = result.current.handlePurchase();
    unmount();
    resolveCharge({
      status: 'successful',
      amount: 500,
      reference: 'WAL-UNMOUNT-AIR',
    });
    await purchase;

    expect(onSuccess).not.toHaveBeenCalled();
    expect(resetWalletIdempotencyKey).not.toHaveBeenCalled();
    expect(refetchWallet).toHaveBeenCalledTimes(1);
    const submitted = mockChargeWalletForVtu.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    const descriptor = buildVtuPurchaseDescriptor(submitted);
    expect(
      isStalePendingVtuSuccess(
        descriptor,
        'WAL-UNMOUNT-AIR',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
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
    const { result } = renderHandler({
      resetWalletIdempotencyKey,
      refetchWallet,
      getIsActive: () => false,
    });
    await result.current.handlePurchase();

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
    const { result } = renderHandler({
      resetWalletIdempotencyKey,
      refetchWallet,
      getIsActive: () => false,
    });
    await result.current.handlePurchase();

    expect(resetWalletIdempotencyKey).not.toHaveBeenCalled();
    // The 5xx may have committed while its response was lost: refresh
    // so reopening does not validate against the pre-debit balance
    // (Codex R55 6rrMIb). Rotation stays off (ambiguous keeps the
    // key) and no Alert may fire over the destination screen.
    expect(refetchWallet).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('keeps an off-screen ambiguous error suppressed when the refresh rejects', async () => {
    // Never-fails wrapper on the error path too: a refetch rejection
    // must degrade to a stale balance, never defeat the suppression
    // by landing in the outer catch's Alert.
    mockChargeWalletForVtu.mockRejectedValueOnce(
      new HttpError(500, 'Gateway error')
    );
    const refetchWallet = jest.fn(() =>
      Promise.reject(new Error('wallet query exploded'))
    );
    const { result } = renderHandler({
      refetchWallet,
      getIsActive: () => false,
    });
    await result.current.handlePurchase();

    expect(refetchWallet).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('suppresses the switch alert but still invalidates when off-screen', async () => {
    // Navigated away AND switched accounts mid-flight: the discard +
    // invalidate still run, but no Alert may fire over the new screen.
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'successful',
      amount: 500,
      reference: 'WAL-SWITCH-OFFSCREEN-AIR',
    });
    const onSuccess = jest.fn();
    const resetWalletIdempotencyKey = jest.fn();
    const invalidateWallets = jest.fn();
    const { result } = renderHandler({
      onSuccess,
      resetWalletIdempotencyKey,
      invalidateWallets,
      isSubmittingOwnerCurrent: () => false,
      getIsActive: () => false,
    });
    await result.current.handlePurchase();

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
        'WAL-SWITCH-OFFSCREEN-AIR',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
  });

  it('waits for the settlement pass before recalling the key', async () => {
    // Settle-then-submit gate (Codex R60 6rs7PV): a submit racing the
    // screen-open pass must not recall a key the pass will forget.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockGetSettlementPass.mockReturnValueOnce(gate);
    mockChargeWalletForVtu.mockResolvedValueOnce({
      status: 'successful',
      amount: 500,
      reference: 'WAL-GATE-AIR',
    });
    const { result } = renderHandler();
    const pending = result.current.handlePurchase();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockChargeWalletForVtu).not.toHaveBeenCalled();
    release();
    await pending;
    expect(mockChargeWalletForVtu).toHaveBeenCalledTimes(1);
    expect(mockGetSettlementPass).toHaveBeenCalledTimes(1);
  });

  it('does not charge when the screen pops during the settlement gate', async () => {
    // Codex R73 6r0cZk: unmount mid-gate must not debit+vend — the
    // defaulted mount probe is rechecked before peek/submit.
    let release!: () => void;
    mockGetSettlementPass.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const { result, unmount } = renderHandler();
    const pending = result.current.handlePurchase();
    unmount();
    release();
    await pending;
    expect(mockChargeWalletForVtu).not.toHaveBeenCalled();
  });

  it('does not charge when the account switches during the settlement gate', async () => {
    // Codex R103 P2: a switch during the pass must not persist or
    // recall the previous owner's peeked attempt under the
    // replacement session — stop before the peek, with no key to
    // finalize.
    let release!: () => void;
    mockGetSettlementPass.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const { result } = renderHandler({
      isSubmittingOwnerCurrent: () => false,
    });
    const pending = result.current.handlePurchase();
    release();
    await pending;
    expect(mockChargeWalletForVtu).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Account Changed',
      'The signed-in account changed while the purchase was starting. Please try again.'
    );
  });
});

describe('airtime purchase checkout guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettlementPass.mockReturnValue(null);
    clearPendingVtuKeys();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    releaseUtilityCheckout();
  });

  function renderGuardedHandler() {
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
          captureSubmittingOwner: () => 'test-owner',
          captureSubmittingUserId: () => 'test-user',
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

  it('refuses a second concurrent checkout without charging', async () => {
    // Codex R77 6sNGO3: a submit on another tab while this checkout
    // is in flight must refuse (Alert) and never reach charge.
    expect(tryAcquireUtilityCheckout()).toBe(true);
    try {
      const { result } = renderGuardedHandler();

      await result.current.handlePurchase();

      expect(mockChargeWalletForVtu).not.toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenCalledWith(
        'Checkout in progress',
        expect.any(String)
      );
      expect(result.current.isSubmitting).toBe(false);
    } finally {
      releaseUtilityCheckout();
    }
  });

  it('releases the guard when the checkout settles', async () => {
    mockChargeWalletForVtu.mockResolvedValueOnce({
      amount: 500,
      reference: 'REF-G',
      status: 'successful',
    });
    const { result } = renderGuardedHandler();

    await result.current.handlePurchase();

    expect(result.current.isSubmitting).toBe(false);
    expect(tryAcquireUtilityCheckout()).toBe(true);
  });
});
