import { renderHook } from '@testing-library/react-native';
import { useUtilityPayment } from '@/hooks/use-utility-payment';
import { walletKeys } from '@/hooks/wallet-query';
import { buildVtuPurchaseDescriptor } from '@/lib/pending-vtu-descriptor';

const mockUseMerchantPaymentSettings = jest.fn();
let mockWalletQuery: {
  data?: {
    wallet: {
      balance: number;
    };
  };
  error?: Error | null;
  getWalletBalance?: () => number;
  isFetchingNow?: () => boolean;
  isLoading?: boolean;
  refetch: jest.Mock;
};

jest.mock('@/hooks/useMerchantPaymentSettings', () => ({
  useMerchantPaymentSettings: () => mockUseMerchantPaymentSettings(),
}));

jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => mockWalletQuery,
}));

const mockInvalidateQueries = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

const mockAuthState: {
  customer: { id: string } | null;
  merchantId: string | null;
  session: { access_token: string } | null;
  user: { id: string } | null;
} = {
  customer: { id: 'customer-a' },
  merchantId: 'merchant-1',
  session: { access_token: 'token-123' },
  user: { id: 'user-a' },
};

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) =>
    selector(mockAuthState),
}));

let mockNextUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `uuid-${++mockNextUuid}`,
}));

describe('useUtilityPayment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNextUuid = 0;
    mockAuthState.session = { access_token: 'token-123' };
    mockAuthState.customer = { id: 'customer-a' };
    mockAuthState.merchantId = 'merchant-1';
    mockAuthState.user = { id: 'user-a' };
    mockUseMerchantPaymentSettings.mockReturnValue({
      data: { wallet_paystack_dva_enabled: true },
    });
    mockWalletQuery = {
      data: { wallet: { balance: 0 } },
      error: null,
      isLoading: false,
      refetch: jest.fn(() => Promise.resolve({})),
    };
  });

  it('exposes a live wallet-balance reader plus loading and error state', () => {
    // Codex R78 6sN80p: a refetch completing during the
    // settlement-gate await must be visible through the same hook
    // result — the gate reads the refreshed cache, not the snapshot.
    let balance = 1500;
    mockWalletQuery = {
      data: { wallet: { balance: 1500 } },
      error: null,
      getWalletBalance: () => balance,
      isLoading: false,
      refetch: jest.fn(() => Promise.resolve({})),
    };
    const { result } = renderHook(() => useUtilityPayment());

    expect(result.current.getWalletBalance()).toBe(1500);
    expect(result.current.walletError).toBeNull();
    expect(result.current.walletIsLoading).toBe(false);
    balance = 3200;
    expect(result.current.getWalletBalance()).toBe(3200);
  });

  it('exposes wallet query loading and error state separately from a zero balance', () => {
    const walletError = new Error('wallet unavailable');
    mockWalletQuery = {
      data: undefined,
      error: walletError,
      getWalletBalance: () => 0,
      isLoading: false,
      refetch: jest.fn(() => Promise.resolve({})),
    };

    const { result } = renderHook(() => useUtilityPayment());

    expect(result.current.getWalletBalance()).toBe(0);
    expect(result.current.walletError).toBe(walletError);
    expect(result.current.walletIsLoading).toBe(false);
  });

  it('exposes a live wallet-refetch reader instead of a snapshot boolean', () => {
    // Codex R75 6r486a: a refetch starting after the snapshot —
    // during the settlement-gate await — must still read true at
    // readiness time through the same hook result.
    let refetching = false;
    mockWalletQuery = {
      data: { wallet: { balance: 1500 } },
      error: null,
      isFetchingNow: () => refetching,
      isLoading: false,
      refetch: jest.fn(() => Promise.resolve({})),
    };
    const { result } = renderHook(() => useUtilityPayment());

    expect(result.current.isWalletRefetching()).toBe(false);
    refetching = true;
    expect(result.current.isWalletRefetching()).toBe(true);
  });

  it('exposes canFundByBankTransfer when authed and the merchant DVA is enabled', () => {
    const { result } = renderHook(() => useUtilityPayment());

    expect(result.current.canFundByBankTransfer).toBe(true);
  });

  it('does not expose canFundByBankTransfer when the merchant DVA is disabled', () => {
    mockUseMerchantPaymentSettings.mockReturnValue({
      data: { wallet_paystack_dva_enabled: false },
    });

    const { result } = renderHook(() => useUtilityPayment());

    expect(result.current.canFundByBankTransfer).toBe(false);
  });

  it('does not expose canFundByBankTransfer when the customer is signed out', () => {
    mockAuthState.session = null;

    const { result } = renderHook(() => useUtilityPayment());

    expect(result.current.canFundByBankTransfer).toBe(false);
  });

  it('exposes session auth state and a wallet refetch for the readiness gate', () => {
    const { result } = renderHook(() => useUtilityPayment());

    expect(result.current.isAuthenticated).toBe(true);
    result.current.refetchWallet();
    expect(mockWalletQuery.refetch).toHaveBeenCalledTimes(1);

    mockAuthState.session = null;
    const { result: signedOut } = renderHook(() => useUtilityPayment());
    expect(signedOut.current.isAuthenticated).toBe(false);
  });

  it('refetchWallet never rejects so rejection paths can safely await it', async () => {
    mockWalletQuery = {
      ...mockWalletQuery,
      refetch: jest.fn(() => Promise.reject(new Error('network down'))),
    };
    const { result } = renderHook(() => useUtilityPayment());

    await expect(result.current.refetchWallet()).resolves.toBeUndefined();
  });

  it('offers no gateway or saved-card state: wallet is the only payment method', () => {
    const { result } = renderHook(() => useUtilityPayment());

    expect(result.current).not.toHaveProperty('selectedGateway');
    expect(result.current).not.toHaveProperty('selectedSavedCardId');
    expect(result.current).not.toHaveProperty('cards');
    expect(result.current).not.toHaveProperty('supportedGateways');
  });

  it('invalidates every cached wallet query when invalidateWallets is called', () => {
    const { result } = renderHook(() => useUtilityPayment());

    result.current.invalidateWallets();

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: walletKeys.all,
      exact: false,
    });
  });

  it('returns a stable wallet idempotency key until it is reset', () => {
    const { result } = renderHook(() => useUtilityPayment());

    const first = result.current.getWalletIdempotencyKey('stable-descriptor');
    const second = result.current.getWalletIdempotencyKey('stable-descriptor');
    expect(first).toBe(second);

    result.current.resetWalletIdempotencyKey('stable-descriptor');
    expect(
      result.current.getWalletIdempotencyKey('stable-descriptor')
    ).not.toBe(first);
  });

  it('recalls the pending key across hook instances for the same purchase', () => {
    // Remount regression: Back to Home + reopen Utilities creates a
    // fresh hook instance; retrying the same purchase MUST reuse the
    // pending key or the server debits a second transaction.
    const firstMount = renderHook(() => useUtilityPayment());
    const key =
      firstMount.result.current.getWalletIdempotencyKey('remount-descriptor');
    firstMount.unmount();

    const secondMount = renderHook(() => useUtilityPayment());
    expect(
      secondMount.result.current.getWalletIdempotencyKey('remount-descriptor')
    ).toBe(key);
  });

  it('peeks retained attempts without minting keys', () => {
    // Codex R65 6ru4mK: readiness needs the registry WITHOUT
    // creating fresh intent; a minting peek would permanently
    // mark every abandoned form as "retained" and let later
    // fresh purchases dodge the insufficient-funds gate. Uses the
    // handlers' real flow: scope-once, then capture by scoped key.
    const { result } = renderHook(() => useUtilityPayment());
    const submitted = { phoneNumber: '08010000001', amount: 1000 };
    const untouched = { phoneNumber: '08010000002', amount: 1000 };

    expect(result.current.hasRetainedVtuAttempt(submitted)).toBe(false);
    result.current.getWalletIdempotencyKey(
      result.current.scopePendingVtuDescriptor(
        buildVtuPurchaseDescriptor(submitted)
      )
    );
    expect(result.current.hasRetainedVtuAttempt(submitted)).toBe(true);
    expect(result.current.hasRetainedVtuAttempt(untouched)).toBe(false);
    // Second peek still false: the first peek minted nothing.
    expect(result.current.hasRetainedVtuAttempt(untouched)).toBe(false);
  });

  it('mints distinct keys for distinct purchases', () => {
    const { result } = renderHook(() => useUtilityPayment());

    const airtime = result.current.getWalletIdempotencyKey('airtime-0801');
    const data = result.current.getWalletIdempotencyKey('data-0801');
    expect(airtime).not.toBe(data);
  });

  it('keeps recalling the pending key when customer hydration lands', () => {
    // Hydration regression: at startup only the Supabase user ID is
    // known; customers.id arrives later and is a DIFFERENT id. Scope
    // must not flip, or the retry orphans the key and double-debits.
    mockAuthState.customer = null;
    mockAuthState.user = { id: 'user-a' };
    const beforeHydration = renderHook(() => useUtilityPayment());
    const scopedBefore =
      beforeHydration.result.current.scopePendingVtuDescriptor('hydration-key');
    const key =
      beforeHydration.result.current.getWalletIdempotencyKey(scopedBefore);
    beforeHydration.unmount();

    mockAuthState.customer = { id: 'customer-a' };
    const afterHydration = renderHook(() => useUtilityPayment());
    const scopedAfter =
      afterHydration.result.current.scopePendingVtuDescriptor('hydration-key');
    expect(scopedAfter).toBe(scopedBefore);
    expect(
      afterHydration.result.current.getWalletIdempotencyKey(scopedAfter)
    ).toBe(key);
  });

  it('keeps the scope stable when merchantId hydrates mid-session', () => {
    // The scope uses the build CONFIG merchant id unconditionally: a
    // merchantId || CONFIG fallback would split a pre-hydration
    // attempt from its post-hydration retry whenever the hydrated id
    // differs, missing recall and double-debiting with a fresh key.
    mockAuthState.merchantId = null;
    const beforeHydration = renderHook(() => useUtilityPayment());
    const scopedBefore =
      beforeHydration.result.current.scopePendingVtuDescriptor(
        'merchant-hydration-key'
      );
    const key =
      beforeHydration.result.current.getWalletIdempotencyKey(scopedBefore);
    beforeHydration.unmount();

    mockAuthState.merchantId = 'merchant-1';
    const afterHydration = renderHook(() => useUtilityPayment());
    const scopedAfter = afterHydration.result.current.scopePendingVtuDescriptor(
      'merchant-hydration-key'
    );
    expect(scopedAfter).toBe(scopedBefore);
    expect(
      afterHydration.result.current.getWalletIdempotencyKey(scopedAfter)
    ).toBe(key);
  });

  it('does not recall another owner’s pending key for the same purchase', () => {
    // Sign-out regression: customer A’s remembered key must be
    // unreachable once customer B signs in, or the route rejects B’s
    // first purchase as belonging to another customer.
    const firstOwner = renderHook(() => useUtilityPayment());
    const scopedA = firstOwner.result.current.scopePendingVtuDescriptor(
      'owner-scoped-descriptor'
    );
    const keyA = firstOwner.result.current.getWalletIdempotencyKey(scopedA);
    firstOwner.unmount();

    mockAuthState.customer = { id: 'customer-b' };
    mockAuthState.user = { id: 'user-b' };
    const secondOwner = renderHook(() => useUtilityPayment());
    const scopedB = secondOwner.result.current.scopePendingVtuDescriptor(
      'owner-scoped-descriptor'
    );
    expect(scopedB).not.toBe(scopedA);
    const keyB = secondOwner.result.current.getWalletIdempotencyKey(scopedB);

    expect(keyB).not.toBe(keyA);
    expect(secondOwner.result.current.getWalletIdempotencyKey(scopedB)).toBe(
      keyB
    );
  });

  it('captures the submitting owner so a mid-flight switch cannot redirect completion', () => {
    // The scoped descriptor is computed once per submission from the
    // submitting account: even if the auth store switches to customer
    // B before A’s request settles, A’s already-scoped key still
    // addresses A’s entry (completion mutates the captured scope).
    const scopedA = renderHook(() =>
      useUtilityPayment()
    ).result.current.scopePendingVtuDescriptor('mid-flight-key');
    const keyA = renderHook(() =>
      useUtilityPayment()
    ).result.current.getWalletIdempotencyKey(scopedA);

    mockAuthState.customer = { id: 'customer-b' };
    mockAuthState.user = { id: 'user-b' };

    const afterSwitch = renderHook(() => useUtilityPayment());
    // A’s captured scope still recalls A’s key after the switch…
    expect(afterSwitch.result.current.getWalletIdempotencyKey(scopedA)).toBe(
      keyA
    );
    // …while B’s own scoping addresses a different entry.
    expect(
      afterSwitch.result.current.scopePendingVtuDescriptor('mid-flight-key')
    ).not.toBe(scopedA);
  });

  it('detects an account switch between capture and settle', () => {
    const { result, rerender } = renderHook(() => useUtilityPayment());
    const submittingOwner = result.current.captureSubmittingOwner();
    expect(result.current.isSubmittingOwnerCurrent(submittingOwner)).toBe(true);

    mockAuthState.user = { id: 'user-b' };
    mockAuthState.customer = { id: 'customer-b' };
    rerender(() => useUtilityPayment());

    expect(result.current.isSubmittingOwnerCurrent(submittingOwner)).toBe(
      false
    );
  });

  it('captures the raw auth user id for token binding (no customer fallback)', () => {
    // The checkout token belongs to the auth user, so the binding
    // capture must not use the scope owner's customer fallback: with
    // no auth user but customer-a still present, it is undefined.
    const { result } = renderHook(() => useUtilityPayment());
    expect(result.current.captureSubmittingUserId()).toBe('user-a');

    mockAuthState.session = null;
    mockAuthState.user = null;
    const { result: signedOut } = renderHook(() => useUtilityPayment());
    expect(signedOut.current.captureSubmittingUserId()).toBeUndefined();
  });

  it('detects a sign-out between capture and settle', () => {
    const { result, rerender } = renderHook(() => useUtilityPayment());
    const submittingOwner = result.current.captureSubmittingOwner();

    mockAuthState.session = null;
    mockAuthState.user = null;
    mockAuthState.customer = null;
    rerender(() => useUtilityPayment());

    expect(result.current.isSubmittingOwnerCurrent(submittingOwner)).toBe(
      false
    );
  });
});
