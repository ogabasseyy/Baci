import { renderHook } from '@testing-library/react-native';
import { useUtilityPayment } from '@/hooks/use-utility-payment';
import { clearPendingVtuKeys } from '@/lib/pending-vtu-idempotency';

const mockUseMerchantPaymentSettings = jest.fn();
let mockWalletQuery: {
  data?: {
    wallet: {
      balance: number;
      primary_balance_kobo?: number;
    };
  };
  error?: Error | null;
  getWalletBalance?: () => number;
  isFetchingNow?: () => boolean;
  isLoading?: boolean;
  isRefetching?: boolean;
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

jest.mock('@/stores/auth-store', () => {
  const useAuthStore = (selector: (state: typeof mockAuthState) => unknown) =>
    selector(mockAuthState);
  (useAuthStore as unknown as Record<string, unknown>).getState = () =>
    mockAuthState;
  return { useAuthStore };
});

let mockNextUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `uuid-${++mockNextUuid}`,
}));

const baseWalletQuery = () => ({
  error: null,
  getWalletBalance: () => 0,
  isFetchingNow: () => false,
  isLoading: false,
  refetch: jest.fn(() => Promise.resolve({})),
});

describe('useUtilityPayment store credit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearPendingVtuKeys();
    mockUseMerchantPaymentSettings.mockReturnValue({
      data: { wallet_paystack_dva_enabled: true },
    });
  });

  it('reports no store credit when the server keeps PiggyVest off', () => {
    mockWalletQuery = {
      ...baseWalletQuery(),
      data: { wallet: { balance: 0 } },
    };

    const { result } = renderHook(() => useUtilityPayment());

    expect(result.current.walletIsStoreCredit).toBeUndefined();
  });

  it('marks the balance store credit for a PiggyVest customer', () => {
    mockWalletQuery = {
      ...baseWalletQuery(),
      data: { wallet: { balance: 0, primary_balance_kobo: 500_000 } },
    };

    const { result } = renderHook(() => useUtilityPayment());

    expect(result.current.walletIsStoreCredit).toBe(true);
  });

  it('holds bank-transfer funding while a cached legacy wallet refreshes', () => {
    mockWalletQuery = {
      ...baseWalletQuery(),
      data: { wallet: { balance: 0 } },
      isRefetching: true,
    };

    const { result } = renderHook(() => useUtilityPayment());

    expect(result.current.walletPrimaryUnknown).toBe(true);
  });

  it("keeps today's funding when the server keeps PiggyVest off and nothing refreshes", () => {
    mockWalletQuery = {
      ...baseWalletQuery(),
      data: { wallet: { balance: 0 } },
    };

    const { result } = renderHook(() => useUtilityPayment());

    expect(result.current.walletPrimaryUnknown).toBeUndefined();
  });
});
