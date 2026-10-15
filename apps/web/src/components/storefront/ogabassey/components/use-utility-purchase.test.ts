import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Customer,
  CustomerUser,
} from '@/contexts/customer-auth-context';
import { publishCustomerIdentity } from '@/contexts/customer-live-identity';
import {
  clearPendingVtuKeys,
  markPendingVtuCompleted,
} from './utility-pending-idempotency';
import { scopePendingVtuSignature } from './utility-pending-vtu-scope';
import type { UtilityCheckoutPayload } from './utility-checkout';
import { buildUtilityCheckoutWalletPayload } from './utility-checkout-wallet-payload';
import { buildVtuWalletPayloadSignature } from './utility-vtu-payload-signature';
import { useUtilityPurchase } from './use-utility-purchase';

const mockSubmit = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockGetSettlementPass = vi.hoisted(() => vi.fn());

vi.mock('./utility-checkout-submit', () => ({
  submitUtilityCheckout: mockSubmit,
}));
vi.mock('@/hooks/use-toast', () => ({ toast: mockToast }));
vi.mock('./use-utility-retained-settlement', () => ({
  getPendingVtuSettlementPass: mockGetSettlementPass,
}));

const customer = {
  id: 'customer-1',
  first_name: 'Test',
  last_name: 'Customer',
  email: 'customer@example.com',
  phone: '08012345678',
} as unknown as Customer;

const user = {
  id: 'user-1',
  email: 'customer@example.com',
  role: 'customer',
} as unknown as CustomerUser;

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    activeTab: 'airtime' as const,
    canFundByBankTransfer: true,
    clearIntent: vi.fn(),
    customer,
    isAuthLoading: false,
    isAuthenticated: true,
    merchantId: 'merchant-1',
    merchantSlug: 'ogabassey',
    isWalletRefreshPending: () => false,
    refreshWallet: vi.fn(),
    setWalletBalance: vi.fn(),
    user,
    getWalletBalance: () => 5000,
    getWalletError: () => false,
    walletLoading: false,
    ...overrides,
  };
}

const airtime = {
  amount: 1000,
  networkProvider: 'MTN',
  phoneNumber: '08012345678',
};

interface RealSignatureSubmitRequest {
  payload: UtilityCheckoutPayload;
  merchantSlug: string;
  customerName: string;
  customerPhone: string | null | undefined;
  expectedUserId: string | null | undefined;
  getWalletIdempotencyKey: (signature: string) => string;
}

/**
 * Mirrors production submitUtilityCheckout: signs with the REAL
 * builder chain so the pre-readiness peek and the capture agree
 * exactly like production, and answers processing (retained).
 */
function mockRealSignatureSubmit(seenKeys: string[]) {
  mockSubmit.mockImplementation(
    async (request: RealSignatureSubmitRequest) => {
      seenKeys.push(
        request.getWalletIdempotencyKey(
          buildVtuWalletPayloadSignature(
            buildUtilityCheckoutWalletPayload({
              merchantSlug: request.merchantSlug,
              customerName: request.customerName,
              customerPhone: request.customerPhone,
              expectedUserId: request.expectedUserId,
              payload: request.payload,
            })
          )
        )
      );
      return {
        kind: 'wallet-success',
        reference: 'REF-PROC',
        amount: 1000,
        processing: true,
      };
    }
  );
}

describe('useUtilityPurchase', () => {
  beforeEach(() => {
    mockSubmit.mockReset();
    mockToast.mockReset();
    mockGetSettlementPass.mockReset();
    mockGetSettlementPass.mockReturnValue(null);
    clearPendingVtuKeys();
    // Live settlement identity starts as the base account (Codex R95
    // P1); switch tests re-publish to simulate the auth mutation.
    publishCustomerIdentity(user, customer, 'ogabassey');
  });

  it('blocks checkout and prompts sign-in when the customer is not authenticated', async () => {
    const { result } = renderHook(() =>
      useUtilityPurchase(baseParams({ isAuthenticated: false, user: null }))
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sign in required' })
    );
    expect(result.current.step).toBe('details');
  });

  it('waits (does not submit) while the auth session is still loading', async () => {
    const { result } = renderHook(() =>
      useUtilityPurchase(baseParams({ isAuthLoading: true }))
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Checking account' })
    );
  });

  it('waits for the settlement pass before submitting', async () => {
    // Settle-then-submit gate (Codex R60 6rs7PV): a submit racing the
    // modal-open pass must not recall a key the pass will forget.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockGetSettlementPass.mockReturnValueOnce(gate);
    mockSubmit.mockResolvedValue({
      kind: 'wallet-success',
      reference: 'REF-GATE',
      amount: 1000,
      processing: false,
    });
    const { result } = renderHook(() => useUtilityPurchase(baseParams()));

    act(() => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    await act(async () => {});
    expect(mockSubmit).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockGetSettlementPass).toHaveBeenCalledTimes(1);
  });

  it('ignores a repeat submit while the settlement pass is pending', async () => {
    // Codex R67 6rwGM2: the settle await runs before setLoading(true),
    // so the Pay UI stays enabled during the wait — a synchronous
    // in-flight guard must swallow the second click, not submit twice.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockGetSettlementPass.mockReturnValue(gate);
    mockSubmit.mockResolvedValue({
      kind: 'wallet-success',
      reference: 'REF-DBL',
      amount: 1000,
      processing: false,
    });
    const { result } = renderHook(() => useUtilityPurchase(baseParams()));

    act(() => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    act(() => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    await act(async () => {});
    expect(mockSubmit).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockGetSettlementPass).toHaveBeenCalledTimes(1);
  });

  it('aborts before submitting when the storefront switches during the gate', async () => {
    // Codex R101 P2: the settlement pass can take seconds — a
    // storefront switch in that window must stop the submit before
    // it posts under the stale store's identity.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockGetSettlementPass.mockReturnValueOnce(gate);
    const { result } = renderHook(() => useUtilityPurchase(baseParams()));

    act(() => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    await act(async () => {});
    expect(mockSubmit).not.toHaveBeenCalled();

    publishCustomerIdentity(user, customer, 'store-b');
    release();
    await act(async () => {});

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Account changed',
      description:
        'The signed-in account changed while the purchase was starting. Please try again.',
    });
    expect(result.current.loading).toBe(false);
  });

  it('does not submit when the modal closes during the settlement gate', async () => {
    // Codex R73 6r0cZk: closing mid-gate must not debit+vend into an
    // abandoned view — liveness is rechecked before peek/submit.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockGetSettlementPass.mockReturnValueOnce(gate);
    mockSubmit.mockResolvedValue({
      kind: 'wallet-success',
      reference: 'REF-ABANDONED',
      amount: 1000,
      processing: false,
    });
    const { result, unmount } = renderHook(() =>
      useUtilityPurchase(baseParams())
    );

    act(() => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    await act(async () => {});
    expect(mockSubmit).not.toHaveBeenCalled();

    unmount();
    await act(async () => {
      release();
    });
    await act(async () => {});

    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('binds the submit to the captured auth user id', async () => {
    mockSubmit.mockResolvedValue({
      kind: 'wallet-success',
      reference: 'REF-BIND',
      amount: 1000,
      processing: false,
    });
    const { result } = renderHook(() => useUtilityPurchase(baseParams()));

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(mockSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUserId: 'user-1' })
    );
  });

  it('waits (does not submit) while the merchant ID is hydrating', async () => {
    // Scoping under '' would split from the post-hydration retry and
    // double-debit; the readiness gate makes the wait explicit.
    const { result } = renderHook(() =>
      useUtilityPurchase(baseParams({ merchantId: undefined }))
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Store unavailable' })
    );
    expect(result.current.step).toBe('details');
  });

  it('completes a wallet purchase: clears the draft, debits the balance, shows success', async () => {
    mockSubmit.mockResolvedValue({
      kind: 'wallet-success',
      reference: 'REF123',
      amount: 1000,
      processing: false,
      voucherPin: 'TOKEN-1',
    });
    const clearIntent = vi.fn();
    const setWalletBalance = vi.fn();
    const { result } = renderHook(() =>
      useUtilityPurchase(baseParams({ clearIntent, setWalletBalance }))
    );

    act(() => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    await waitFor(() => expect(result.current.step).toBe('success'));
    expect(clearIntent).toHaveBeenCalledTimes(1);
    expect(result.current.transactionRef).toBe('REF123');
    expect(result.current.successAmount).toBe(1000);
    expect(result.current.transactionVoucherPin).toBe('TOKEN-1');
    // Balance is debited via a functional update (5000 - 1000).
    const updater = setWalletBalance.mock.calls[0][0] as (n: number) => number;
    expect(updater(5000)).toBe(4000);
  });

  it('blocks checkout without a network call when the wallet cannot cover the bill', async () => {
    const onInsufficientWalletBalance = vi.fn();
    const { result } = renderHook(() =>
      useUtilityPurchase(
        baseParams({ onInsufficientWalletBalance, getWalletBalance: () => 500 })
      )
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Insufficient wallet balance',
      description:
        'Fund your wallet with at least ₦500 more to complete this purchase.',
      variant: 'destructive',
    });
    expect(onInsufficientWalletBalance).toHaveBeenCalledTimes(1);
    expect(result.current.step).toBe('details');
    expect(result.current.loading).toBe(false);
  });

  it('lets a retained retry resubmit when the wallet later reads short', async () => {
    // Codex R65 6ru4mK: the wallet covered the bill at submit time;
    // the debit landed server-side but the response was lost. The
    // retry must replay (same key), not stall behind top-up.
    const seenKeys: string[] = [];
    mockRealSignatureSubmit(seenKeys);
    const { result, rerender } = renderHook(
      (props: ReturnType<typeof baseParams>) => useUtilityPurchase(props),
      { initialProps: baseParams({}) }
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    expect(mockSubmit).toHaveBeenCalledTimes(1);

    // Post-debit the wallet reads empty; the retry must still replay.
    rerender(baseParams({ getWalletBalance: () => 0 }));
    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(mockSubmit).toHaveBeenCalledTimes(2);
    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[0]).toBe(seenKeys[1]);
  });

  it('re-checks retention after the settlement pass forgets the retained key', async () => {
    // Codex R66 6rvh_M: the modal-open pass proves the old
    // transaction terminal and forgets its key. Readiness must see
    // the POST-settle registry: bypassing on the stale peek would
    // mint fresh and die server-side instead of opening funding.
    const seenKeys: string[] = [];
    mockRealSignatureSubmit(seenKeys);
    const { result, rerender } = renderHook(
      (props: ReturnType<typeof baseParams>) => useUtilityPurchase(props),
      { initialProps: baseParams({}) }
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    expect(mockSubmit).toHaveBeenCalledTimes(1);

    // The pass settles (forgets) the retained entry while the
    // retry's wallet reads short: the retry must block, not bypass.
    mockGetSettlementPass.mockReturnValueOnce(
      Promise.resolve().then(() => {
        clearPendingVtuKeys();
      })
    );
    rerender(baseParams({ getWalletBalance: () => 0 }));
    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(seenKeys).toHaveLength(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Insufficient wallet balance' })
    );
    // The blocked retry leaves the shown pending view untouched.
    expect(result.current.step).toBe('processing');
  });

  it('waits (does not submit) while the wallet balance is still loading', async () => {
    const { result } = renderHook(() =>
      useUtilityPurchase(baseParams({ walletLoading: true, getWalletBalance: () => 0 }))
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Checking wallet balance' })
    );
    expect(result.current.step).toBe('details');
  });

  it('retries the wallet fetch instead of submitting when the balance lookup failed', async () => {
    const refreshWallet = vi.fn();
    const { result } = renderHook(() =>
      useUtilityPurchase(
        baseParams({ refreshWallet, getWalletError: () => true, getWalletBalance: () => 0 })
      )
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Wallet unavailable' })
    );
    expect(refreshWallet).toHaveBeenCalledTimes(1);
    expect(result.current.step).toBe('details');
  });

  it('retains the idempotency key while a purchase is processing so a resubmit replays', async () => {
    const seenKeys: string[] = [];
    mockSubmit.mockImplementation(
      async (request: {
        getWalletIdempotencyKey: (signature: string) => string;
      }) => {
        seenKeys.push(request.getWalletIdempotencyKey('SIG'));
        return {
          kind: 'wallet-success',
          reference: 'REF-PROC',
          amount: 1000,
          processing: true,
        };
      }
    );
    const refreshWallet = vi.fn();
    const { result } = renderHook(() =>
      useUtilityPurchase(baseParams({ refreshWallet }))
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[0]).toBe(seenKeys[1]);
    // The deferred debit reconciles via refresh even if never replayed.
    expect(refreshWallet).toHaveBeenCalled();
  });

  it('shows the pending step (not success) while a purchase is processing', async () => {
    mockSubmit.mockResolvedValue({
      kind: 'wallet-success',
      reference: 'REF-PROC',
      amount: 1000,
      processing: true,
    });
    const setWalletBalance = vi.fn();
    const { result } = renderHook(() =>
      useUtilityPurchase(baseParams({ setWalletBalance }))
    );

    act(() => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    await waitFor(() => expect(result.current.step).toBe('processing'));
    expect(result.current.transactionRef).toBe('REF-PROC');
    // Non-terminal: no balance effect until the success replay lands.
    expect(setWalletBalance).not.toHaveBeenCalled();
  });

  it('reuses the pending key across modal remounts for the same purchase', async () => {
    const seenKeys: string[] = [];
    mockSubmit.mockImplementation(
      async (request: {
        getWalletIdempotencyKey: (signature: string) => string;
      }) => {
        seenKeys.push(request.getWalletIdempotencyKey('SIG'));
        return {
          kind: 'wallet-success',
          reference: 'REF-PROC',
          amount: 1000,
          processing: true,
        };
      }
    );
    const first = renderHook(() => useUtilityPurchase(baseParams()));
    await act(async () => {
      first.result.current.handleAirtimeDataSubmit(airtime);
    });
    await waitFor(() => expect(first.result.current.step).toBe('processing'));
    // Done unmounts the modal; reopening mounts a fresh hook instance.
    first.unmount();

    const second = renderHook(() => useUtilityPurchase(baseParams()));
    await act(async () => {
      second.result.current.handleAirtimeDataSubmit(airtime);
    });
    await waitFor(() => expect(second.result.current.step).toBe('processing'));

    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[1]).toBe(seenKeys[0]);
  });

  it('refreshes (does not decrement) when a recalled key resolves after a lost response', async () => {
    // P2: the first POST's response is lost with no reference noted;
    // after a reload the balance refetch already reflects the debit
    // while the registry recalls the original key. The replay success
    // is unrecognized (no noted reference), so without the recalled-key
    // check the hook would decrement the already-debited balance again
    // and block valid follow-ups as underfunded.
    let calls = 0;
    mockSubmit.mockImplementation(
      async (request: {
        getWalletIdempotencyKey: (signature: string) => string;
      }) => {
        request.getWalletIdempotencyKey('SIG');
        calls += 1;
        if (calls === 1) {
          return { kind: 'error', message: 'timeout' };
        }
        return {
          kind: 'wallet-success',
          reference: 'REF-1',
          amount: 1000,
          processing: false,
        };
      }
    );
    const refreshWallet = vi.fn();
    const setWalletBalance = vi.fn();
    const first = renderHook(() =>
      useUtilityPurchase(baseParams({ refreshWallet, setWalletBalance }))
    );
    await act(async () => {
      first.result.current.handleAirtimeDataSubmit(airtime);
    });
    first.unmount();

    const second = renderHook(() =>
      useUtilityPurchase(baseParams({ refreshWallet, setWalletBalance }))
    );
    await act(async () => {
      second.result.current.handleAirtimeDataSubmit(airtime);
    });
    await waitFor(() => expect(second.result.current.step).toBe('success'));

    expect(refreshWallet).toHaveBeenCalled();
    expect(setWalletBalance).not.toHaveBeenCalled();
  });

  it('rotates the idempotency key after a terminal success so buy-again is a fresh purchase', async () => {
    const seenKeys: string[] = [];
    mockSubmit.mockImplementation(
      async (request: {
        getWalletIdempotencyKey: (signature: string) => string;
      }) => {
        seenKeys.push(request.getWalletIdempotencyKey('SIG'));
        return {
          kind: 'wallet-success',
          reference: 'REF-OK',
          amount: 1000,
          processing: false,
        };
      }
    );
    const { result } = renderHook(() => useUtilityPurchase(baseParams()));

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[0]).not.toBe(seenKeys[1]);
  });

  it('rotates the idempotency key after a terminal 4xx so a corrected retry is a fresh attempt', async () => {
    const seenKeys: string[] = [];
    mockSubmit.mockImplementation(
      async (request: {
        getWalletIdempotencyKey: (signature: string) => string;
      }) => {
        seenKeys.push(request.getWalletIdempotencyKey('SIG'));
        return { kind: 'error', message: 'Payment failed', status: 400 };
      }
    );
    const { result } = renderHook(() => useUtilityPurchase(baseParams()));

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[0]).not.toBe(seenKeys[1]);
  });

  it('refetches the wallet after a terminal failure so the retry sees restored credit', async () => {
    // A failed vend may have refunded the debit; without a refetch the
    // readiness gate would reject the retry on a stale-low balance.
    mockSubmit.mockResolvedValue({
      kind: 'error',
      message: 'Payment failed',
      status: 400,
    });
    const refreshWallet = vi.fn();
    const { result } = renderHook(() =>
      useUtilityPurchase(baseParams({ refreshWallet }))
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(refreshWallet).toHaveBeenCalledTimes(1);
  });

  it('keeps the idempotency key after a 5xx so the retry replays instead of double-charging', async () => {
    const seenKeys: string[] = [];
    mockSubmit.mockImplementation(
      async (request: {
        getWalletIdempotencyKey: (signature: string) => string;
      }) => {
        seenKeys.push(request.getWalletIdempotencyKey('SIG'));
        return { kind: 'error', message: 'Server error', status: 502 };
      }
    );
    const { result } = renderHook(() => useUtilityPurchase(baseParams()));

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[0]).toBe(seenKeys[1]);
  });

  it('keeps the idempotency key after a pre-route 429 so the retry dedupes', async () => {
    const seenKeys: string[] = [];
    mockSubmit.mockImplementation(
      async (request: {
        getWalletIdempotencyKey: (signature: string) => string;
      }) => {
        seenKeys.push(request.getWalletIdempotencyKey('SIG'));
        return { kind: 'error', message: 'Too many requests', status: 429 };
      }
    );
    const { result } = renderHook(() => useUtilityPurchase(baseParams()));

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[0]).toBe(seenKeys[1]);
  });

  it('applies the server cashback balance instead of decrementing the local balance', async () => {
    mockSubmit.mockResolvedValue({
      kind: 'wallet-success',
      reference: 'REF-CB',
      amount: 1000,
      processing: false,
      cashback: { amount: 50, newBalance: 4050 },
    });
    const setWalletBalance = vi.fn();
    const { result } = renderHook(() =>
      useUtilityPurchase(baseParams({ setWalletBalance }))
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    await waitFor(() => expect(result.current.step).toBe('success'));
    expect(setWalletBalance).toHaveBeenCalledWith(4050);
  });

  it('says plainly that top-up is unavailable when the store has no funding rail', async () => {
    const onInsufficientWalletBalance = vi.fn();
    const { result } = renderHook(() =>
      useUtilityPurchase(
        baseParams({
          canFundByBankTransfer: false,
          onInsufficientWalletBalance,
          getWalletBalance: () => 500,
        })
      )
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Insufficient wallet balance',
      description:
        'Your wallet balance of ₦500 is ₦500 short. Wallet top-up isn\'t available for this store.',
      variant: 'destructive',
    });
    expect(onInsufficientWalletBalance).not.toHaveBeenCalled();
  });

  it('applies the balance effect once per reference across idempotent replays', async () => {
    mockSubmit
      .mockResolvedValueOnce({
        kind: 'wallet-success',
        reference: 'REF-SAME',
        amount: 1000,
        processing: true,
      })
      .mockResolvedValueOnce({
        kind: 'wallet-success',
        reference: 'REF-SAME',
        amount: 1000,
        processing: false,
      })
      .mockResolvedValueOnce({
        kind: 'wallet-success',
        reference: 'REF-NEW',
        amount: 1000,
        processing: false,
      });
    const setWalletBalance = vi.fn();
    const { result } = renderHook(() =>
      useUtilityPurchase(baseParams({ setWalletBalance }))
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    // Processing defers the effect: the vend may still fail and refund.
    expect(setWalletBalance).not.toHaveBeenCalled();
    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    // Same reference replayed to success: balance applied once.
    expect(setWalletBalance).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    // New reference: genuine second purchase, applied again.
    expect(setWalletBalance).toHaveBeenCalledTimes(2);
  });

  it('presents a slow first completion instead of already-completed', async () => {
    // Staleness keys off OBSERVED completion, not the submit: a 202
    // noted early and completed minutes later (reconciliation) must
    // present the vend. The old age-of-submit check misreported this
    // as "Already Completed", forgot the key, and double-debited the
    // prompted retry.
    vi.useFakeTimers();
    try {
      const seenKeys: string[] = [];
      mockSubmit.mockImplementation(
        async (request: {
          getWalletIdempotencyKey: (signature: string) => string;
        }) => {
          seenKeys.push(request.getWalletIdempotencyKey('SIG'));
          // First submit is still processing; the replay lands later.
          return seenKeys.length === 1
            ? {
                kind: 'wallet-success',
                reference: 'REF-OLD',
                amount: 1000,
                processing: true,
              }
            : {
                kind: 'wallet-success',
                reference: 'REF-OLD',
                amount: 1000,
                processing: false,
              };
        }
      );
      const setWalletBalance = vi.fn();
      const { result } = renderHook(() =>
        useUtilityPurchase(baseParams({ setWalletBalance }))
      );

      await act(async () => {
        result.current.handleAirtimeDataSubmit(airtime);
      });
      // waitFor hangs under fake timers; the awaited act already flushes.
      expect(result.current.step).toBe('processing');

      // The vend settles minutes later; the replay is its FIRST
      // completion — present it.
      vi.advanceTimersByTime(6 * 60 * 1000);
      await act(async () => {
        result.current.handleAirtimeDataSubmit(airtime);
      });

      expect(result.current.step).toBe('success');
      expect(result.current.transactionRef).toBe('REF-OLD');
      // Same key replayed (not a fresh mint), no Already-Completed prompt.
      expect(seenKeys).toHaveLength(2);
      expect(seenKeys[1]).toBe(seenKeys[0]);
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Purchase Already Completed' })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a replay past the completion window as already-completed', async () => {
    vi.useFakeTimers();
    try {
      const seenKeys: string[] = [];
      mockSubmit.mockImplementation(
        async (request: {
          getWalletIdempotencyKey: (signature: string) => string;
        }) => {
          seenKeys.push(request.getWalletIdempotencyKey('SIG'));
          // First submit is still processing; the replay lands later.
          return seenKeys.length === 1
            ? {
                kind: 'wallet-success',
                reference: 'REF-OLD',
                amount: 1000,
                processing: true,
              }
            : {
                kind: 'wallet-success',
                reference: 'REF-OLD',
                amount: 1000,
                processing: false,
              };
        }
      );
      const setWalletBalance = vi.fn();
      const { result } = renderHook(() =>
        useUtilityPurchase(baseParams({ setWalletBalance }))
      );

      await act(async () => {
        result.current.handleAirtimeDataSubmit(airtime);
      });
      expect(result.current.step).toBe('processing');

      // Completion is observed (as a switch-back replay would), then
      // the customer returns long after with the same payload: a NEW
      // intent, so the replay must not present the old vend.
      const scoped = scopePendingVtuSignature('user-1', 'merchant-1', 'SIG');
      vi.advanceTimersByTime(60 * 1000);
      markPendingVtuCompleted(scoped);
      vi.advanceTimersByTime(6 * 60 * 1000);
      await act(async () => {
        result.current.handleAirtimeDataSubmit(airtime);
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Purchase Already Completed',
        description:
          'This purchase already completed (REF-OLD). Submit again to make a new purchase.',
        variant: 'destructive',
      });
      // Old vend is not presented as the new purchase…
      expect(result.current.step).toBe('processing');
      expect(setWalletBalance).not.toHaveBeenCalled();
      // …and the dead key is forgotten so the next tap mints fresh.
      await act(async () => {
        result.current.handleAirtimeDataSubmit(airtime);
      });
      expect(seenKeys).toHaveLength(3);
      expect(seenKeys[2]).not.toBe(seenKeys[0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes (never double-decrements) when a noted processing vend resolves', async () => {
    mockSubmit.mockImplementation(
      async (request: {
        getWalletIdempotencyKey: (signature: string) => string;
      }) => {
        request.getWalletIdempotencyKey('SIG');
        return mockSubmit.mock.calls.length === 1
          ? {
              kind: 'wallet-success',
              reference: 'REF-NOTED',
              amount: 1000,
              processing: true,
            }
          : {
              kind: 'wallet-success',
              reference: 'REF-NOTED',
              amount: 1000,
              processing: false,
            };
      }
    );
    const refreshWallet = vi.fn();
    const setWalletBalance = vi.fn();
    const { result } = renderHook(() =>
      useUtilityPurchase(baseParams({ refreshWallet, setWalletBalance }))
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    // Processing defers the effect and fires a refresh.
    expect(setWalletBalance).not.toHaveBeenCalled();
    expect(refreshWallet).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    // Noted replay: refresh for server truth, never a local decrement —
    // the debit is already reflected (remounts refetch too).
    await waitFor(() => expect(result.current.step).toBe('success'));
    expect(setWalletBalance).not.toHaveBeenCalled();
    expect(refreshWallet).toHaveBeenCalledTimes(2);
  });

  it('surfaces an error toast and stays on the form when checkout fails', async () => {
    mockSubmit.mockResolvedValue({
      kind: 'error',
      message: 'Insufficient funds',
    });
    const { result } = renderHook(() => useUtilityPurchase(baseParams()));

    act(() => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Transaction Failed',
          description: 'Insufficient funds',
          variant: 'destructive',
        })
      )
    );
    expect(result.current.step).toBe('details');
  });

  it('discards the result when the account switches mid-flight', async () => {
    let resolveSubmit!: (
      value:
        | { kind: 'wallet-success'; reference: string; amount: number; processing: boolean }
        | { kind: 'error'; message: string }
    ) => void;
    mockSubmit.mockImplementation(
      () =>
        new Promise<
          | { kind: 'wallet-success'; reference: string; amount: number; processing: boolean }
          | { kind: 'error'; message: string }
        >((resolve) => {
          resolveSubmit = resolve;
        })
    );
    const customerB = { ...customer, id: 'customer-2' };
    const userB = { ...user, id: 'user-2' };
    const setWalletBalance = vi.fn();
    const { result, rerender } = renderHook(
      (props: { customer: Customer; user: CustomerUser }) =>
        useUtilityPurchase(
          baseParams({
            customer: props.customer,
            user: props.user,
            setWalletBalance,
          })
        ),
      { initialProps: { customer, user } }
    );

    act(() => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    expect(result.current.loading).toBe(true);

    // Shared browser switches to customer B before A's request settles.
    rerender({ customer: customerB, user: userB });
    publishCustomerIdentity(userB, customerB, 'ogabassey');
    await act(async () => {
      resolveSubmit({
        kind: 'wallet-success',
        reference: 'REF-A',
        amount: 1000,
        processing: false,
      });
    });

    // A's result is dropped: no balance write, no success screen for B.
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Account changed',
      description:
        'The signed-in account changed while the purchase was processing. The result was discarded.',
    });
    expect(setWalletBalance).not.toHaveBeenCalled();
    expect(result.current.step).toBe('details');
    expect(result.current.transactionRef).toBe('');
    expect(result.current.loading).toBe(false);
  });

  it('discards the result when the storefront switches but the user stays', async () => {
    // Codex R101 P2: the same auth user signs into a replacement
    // store before A's request settles — the user-first account leg
    // still matches, so only the merchant leg discards A's result
    // before its reference/voucher publishes into the new store.
    let resolveSubmit!: (value: {
      kind: 'wallet-success';
      reference: string;
      amount: number;
      processing: boolean;
    }) => void;
    mockSubmit.mockImplementation(
      () =>
        new Promise<{
          kind: 'wallet-success';
          reference: string;
          amount: number;
          processing: boolean;
        }>((resolve) => {
          resolveSubmit = resolve;
        })
    );
    const customerB = { ...customer, id: 'customer-2' };
    const setWalletBalance = vi.fn();
    const { result, rerender } = renderHook(
      (props: { customer: Customer; merchantSlug: string }) =>
        useUtilityPurchase(
          baseParams({
            customer: props.customer,
            merchantSlug: props.merchantSlug,
            setWalletBalance,
          })
        ),
      { initialProps: { customer, merchantSlug: 'ogabassey' } }
    );

    act(() => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    expect(result.current.loading).toBe(true);

    rerender({ customer: customerB, merchantSlug: 'store-b' });
    publishCustomerIdentity(user, customerB, 'store-b');
    await act(async () => {
      resolveSubmit({
        kind: 'wallet-success',
        reference: 'REF-A',
        amount: 1000,
        processing: false,
      });
    });

    expect(mockToast).toHaveBeenCalledWith({
      title: 'Account changed',
      description:
        'The signed-in account changed while the purchase was processing. The result was discarded.',
    });
    expect(setWalletBalance).not.toHaveBeenCalled();
    expect(result.current.step).toBe('details');
    expect(result.current.transactionRef).toBe('');
    expect(result.current.loading).toBe(false);
  });

  it('discards the result when the switch lands before React rerenders', async () => {
    // Codex R95 P1: the auth mutation publishes synchronously but the
    // checkout promise settles before React renders this hook — a
    // render-derived ref would still name the submitting account and
    // accept the stale result into the replacement session.
    let resolveSubmit!: (value: {
      kind: 'wallet-success';
      reference: string;
      amount: number;
      processing: boolean;
    }) => void;
    mockSubmit.mockImplementation(
      () =>
        new Promise<{
          kind: 'wallet-success';
          reference: string;
          amount: number;
          processing: boolean;
        }>((resolve) => {
          resolveSubmit = resolve;
        })
    );
    const customerB = { ...customer, id: 'customer-2' };
    const userB = { ...user, id: 'user-2' };
    const setWalletBalance = vi.fn();
    const { result } = renderHook(() =>
      useUtilityPurchase(baseParams({ setWalletBalance }))
    );

    act(() => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    // Switch publishes with NO rerender: the hook's props still name A.
    publishCustomerIdentity(userB, customerB, 'ogabassey');
    await act(async () => {
      resolveSubmit({
        kind: 'wallet-success',
        reference: 'REF-A',
        amount: 1000,
        processing: false,
      });
    });

    expect(mockToast).toHaveBeenCalledWith({
      title: 'Account changed',
      description:
        'The signed-in account changed while the purchase was processing. The result was discarded.',
    });
    expect(setWalletBalance).not.toHaveBeenCalled();
    expect(result.current.step).toBe('details');
    expect(result.current.transactionRef).toBe('');
  });

  it('applies the result when the customer row hydrates mid-flight (same user)', async () => {
    // Hydration is not a switch: submitting with a user-only identity
    // and settling after the customer row lands must apply, not
    // discard — discarding would forget the terminal key and the
    // retry would double-debit with a fresh key.
    let resolveSubmit!: (value: {
      kind: 'wallet-success';
      reference: string;
      amount: number;
      processing: boolean;
    }) => void;
    mockSubmit.mockImplementation(
      () =>
        new Promise<{
          kind: 'wallet-success';
          reference: string;
          amount: number;
          processing: boolean;
        }>((resolve) => {
          resolveSubmit = resolve;
        })
    );
    const setWalletBalance = vi.fn();
    const { result, rerender } = renderHook(
      (props: { customer: Customer | null }) =>
        useUtilityPurchase(
          baseParams({ customer: props.customer, setWalletBalance })
        ),
      { initialProps: { customer: null as Customer | null } }
    );

    act(() => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    // Customer row hydrates before A's request settles.
    rerender({ customer });
    publishCustomerIdentity(user, customer, 'ogabassey');
    await act(async () => {
      resolveSubmit({
        kind: 'wallet-success',
        reference: 'REF-A',
        amount: 1000,
        processing: false,
      });
    });

    expect(result.current.step).toBe('success');
    expect(result.current.transactionRef).toBe('REF-A');
    expect(setWalletBalance).toHaveBeenCalled();
  });

  it('preserves the submitter key on switch-discard so the returnee replays it', async () => {
    // P1: A's success settles after the switch to B. The entry must be
    // PRESERVED before the UI is suppressed — forgetting would mint a
    // fresh key on A's switch-back repeat and debit/vend a second time.
    // The repeat replays the original outcome (REF-A); a genuinely new
    // intent is still safe via the stale-success guard (separate test).
    type SubmitResult =
      | {
          kind: 'wallet-success';
          reference: string;
          amount: number;
          processing: boolean;
        }
      | { kind: 'error'; message: string };
    const seenKeys: string[] = [];
    let resolveSubmit!: (value: SubmitResult) => void;
    mockSubmit.mockImplementation(
      async (request: {
        getWalletIdempotencyKey: (signature: string) => string;
      }) => {
        seenKeys.push(request.getWalletIdempotencyKey('SIG'));
        if (seenKeys.length === 1) {
          return new Promise<SubmitResult>((resolve) => {
            resolveSubmit = resolve;
          });
        }
        // Same key ⇒ the route replays A's original transaction.
        return {
          kind: 'wallet-success',
          reference: 'REF-A',
          amount: 1000,
          processing: false,
        };
      }
    );
    const customerB = { ...customer, id: 'customer-2' };
    const userB = { ...user, id: 'user-2' };
    const { result, rerender } = renderHook(
      (props: { customer: Customer; user: CustomerUser }) =>
        useUtilityPurchase(
          baseParams({ customer: props.customer, user: props.user })
        ),
      { initialProps: { customer, user } }
    );

    act(() => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    rerender({ customer: customerB, user: userB });
    publishCustomerIdentity(userB, customerB, 'ogabassey');
    await act(async () => {
      resolveSubmit({
        kind: 'wallet-success',
        reference: 'REF-A',
        amount: 1000,
        processing: false,
      });
    });

    // A switches back and repeats the same purchase: same key, the
    // original outcome reports — no second debit.
    rerender({ customer, user });
    publishCustomerIdentity(user, customer, 'ogabassey');
    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[1]).toBe(seenKeys[0]);
    expect(result.current.step).toBe('success');
    expect(result.current.transactionRef).toBe('REF-A');
  });

  it('retains the key when the modal unmounts before a terminal success resolves', async () => {
    // Closing the modal mid-flight preserves the completed attempt
    // like a suppressed switch: forgetting would mint fresh on
    // reopen and debit/vend a second time.
    type SubmitResult = {
      kind: 'wallet-success';
      reference: string;
      amount: number;
      processing: boolean;
    };
    const seenKeys: string[] = [];
    let resolveSubmit!: (value: SubmitResult) => void;
    mockSubmit.mockImplementation(
      async (request: {
        getWalletIdempotencyKey: (signature: string) => string;
      }) => {
        seenKeys.push(request.getWalletIdempotencyKey('SIG'));
        if (seenKeys.length === 1) {
          return new Promise<SubmitResult>((resolve) => {
            resolveSubmit = resolve;
          });
        }
        // Same key ⇒ the route replays the original transaction.
        return {
          kind: 'wallet-success',
          reference: 'REF-A',
          amount: 1000,
          processing: false,
        };
      }
    );
    const { result, unmount } = renderHook(() =>
      useUtilityPurchase(baseParams())
    );

    act(() => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    unmount();
    await act(async () => {
      resolveSubmit({
        kind: 'wallet-success',
        reference: 'REF-A',
        amount: 1000,
        processing: false,
      });
    });

    // Reopen (fresh hook instance, same module registry) and repeat
    // the apparently unanswered purchase: same key, original outcome.
    const reopened = renderHook(() => useUtilityPurchase(baseParams()));
    await act(async () => {
      reopened.result.current.handleAirtimeDataSubmit(airtime);
    });

    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[1]).toBe(seenKeys[0]);
    expect(reopened.result.current.step).toBe('success');
    expect(reopened.result.current.transactionRef).toBe('REF-A');
  });

  it('settleBackfilledAttempt forgets the shown 202 key and refetches the wallet', async () => {
    // The voucher backfill proved the shown 202 terminal: the next
    // same-payload submit must mint fresh (not replay the old vend as
    // a new success), and the wallet must refetch (the debit — or a
    // later worker refund — settled after the optimistic update).
    const seenKeys: string[] = [];
    mockSubmit.mockImplementation(
      async (request: {
        getWalletIdempotencyKey: (signature: string) => string;
      }) => {
        seenKeys.push(request.getWalletIdempotencyKey('SIG'));
        return {
          kind: 'wallet-success',
          reference: 'REF-PROC',
          amount: 1000,
          processing: true,
        };
      }
    );
    const refreshWallet = vi.fn();
    const { result } = renderHook(() =>
      useUtilityPurchase(baseParams({ refreshWallet }))
    );

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    expect(result.current.step).toBe('processing');
    const refreshesAfterSubmit = refreshWallet.mock.calls.length;

    act(() => {
      result.current.settleBackfilledAttempt();
    });
    expect(refreshWallet.mock.calls.length).toBe(refreshesAfterSubmit + 1);

    await act(async () => {
      result.current.handleAirtimeDataSubmit(airtime);
    });
    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[1]).not.toBe(seenKeys[0]);
  });
});
