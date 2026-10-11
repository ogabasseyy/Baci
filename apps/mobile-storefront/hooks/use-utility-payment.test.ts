import { renderHook } from '@testing-library/react-native';
import { useUtilityPayment } from '@/hooks/use-utility-payment';

const mockUseMerchantPaymentSettings = jest.fn();
let mockWalletQuery: {
  data?: {
    wallet: {
      balance: number;
    };
  };
  error?: Error | null;
  isLoading?: boolean;
  refetch: jest.Mock;
};

jest.mock('@/hooks/useMerchantPaymentSettings', () => ({
  useMerchantPaymentSettings: () => mockUseMerchantPaymentSettings(),
}));

jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => mockWalletQuery,
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
      refetch: jest.fn(),
    };
  });

  it('exposes the wallet balance, loading and error state', () => {
    mockWalletQuery = {
      data: { wallet: { balance: 1500 } },
      error: null,
      isLoading: false,
      refetch: jest.fn(),
    };
    const { result } = renderHook(() => useUtilityPayment());

    expect(result.current.walletBalance).toBe(1500);
    expect(result.current.walletError).toBeNull();
    expect(result.current.walletIsLoading).toBe(false);
  });

  it('exposes wallet query loading and error state separately from a zero balance', () => {
    const walletError = new Error('wallet unavailable');
    mockWalletQuery = {
      data: undefined,
      error: walletError,
      isLoading: false,
      refetch: jest.fn(),
    };

    const { result } = renderHook(() => useUtilityPayment());

    expect(result.current.walletBalance).toBe(0);
    expect(result.current.walletError).toBe(walletError);
    expect(result.current.walletIsLoading).toBe(false);
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

  it('offers no gateway or saved-card state: wallet is the only payment method', () => {
    const { result } = renderHook(() => useUtilityPayment());

    expect(result.current).not.toHaveProperty('selectedGateway');
    expect(result.current).not.toHaveProperty('selectedSavedCardId');
    expect(result.current).not.toHaveProperty('cards');
    expect(result.current).not.toHaveProperty('supportedGateways');
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
    const key =
      beforeHydration.result.current.getWalletIdempotencyKey('hydration-key');
    beforeHydration.unmount();

    mockAuthState.customer = { id: 'customer-a' };
    const afterHydration = renderHook(() => useUtilityPayment());
    expect(
      afterHydration.result.current.getWalletIdempotencyKey('hydration-key')
    ).toBe(key);
  });

  it('does not recall another owner’s pending key for the same purchase', () => {
    // Sign-out regression: customer A’s remembered key must be
    // unreachable once customer B signs in, or the route rejects B’s
    // first purchase as belonging to another customer.
    const firstOwner = renderHook(() => useUtilityPayment());
    const keyA = firstOwner.result.current.getWalletIdempotencyKey(
      'owner-scoped-descriptor'
    );
    firstOwner.unmount();

    mockAuthState.customer = { id: 'customer-b' };
    mockAuthState.user = { id: 'user-b' };
    const secondOwner = renderHook(() => useUtilityPayment());
    const keyB = secondOwner.result.current.getWalletIdempotencyKey(
      'owner-scoped-descriptor'
    );

    expect(keyB).not.toBe(keyA);
    expect(
      secondOwner.result.current.getWalletIdempotencyKey(
        'owner-scoped-descriptor'
      )
    ).toBe(keyB);
  });
});
