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
};

jest.mock('@/hooks/useMerchantPaymentSettings', () => ({
  useMerchantPaymentSettings: () => mockUseMerchantPaymentSettings(),
}));

jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => mockWalletQuery,
}));

const mockAuthState: {
  session: { access_token: string } | null;
} = {
  session: { access_token: 'token-123' },
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
    mockUseMerchantPaymentSettings.mockReturnValue({
      data: { wallet_paystack_dva_enabled: true },
    });
    mockWalletQuery = {
      data: { wallet: { balance: 0 } },
      error: null,
      isLoading: false,
    };
  });

  it('exposes the wallet balance, loading and error state', () => {
    mockWalletQuery = {
      data: { wallet: { balance: 1500 } },
      error: null,
      isLoading: false,
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

  it('offers no gateway or saved-card state: wallet is the only payment method', () => {
    const { result } = renderHook(() => useUtilityPayment());

    expect(result.current).not.toHaveProperty('selectedGateway');
    expect(result.current).not.toHaveProperty('selectedSavedCardId');
    expect(result.current).not.toHaveProperty('cards');
    expect(result.current).not.toHaveProperty('supportedGateways');
  });

  it('returns a stable wallet idempotency key until it is reset', () => {
    const { result } = renderHook(() => useUtilityPayment());

    const first = result.current.getWalletIdempotencyKey();
    const second = result.current.getWalletIdempotencyKey();
    expect(first).toBe(second);

    result.current.resetWalletIdempotencyKey();
    expect(result.current.getWalletIdempotencyKey()).not.toBe(first);
  });
});
