import { renderHook } from '@testing-library/react-native';
import { useUtilityPayment } from '@/hooks/use-utility-payment';
import { clearPendingVtuKeys } from '@/lib/pending-vtu-idempotency';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';

const mockUseMerchantPaymentSettings = jest.fn();
let mockWalletQuery: {
  data?: {
    wallet: {
      balance: number;
      owner_unresolved?: boolean;
      primary_balance_kobo?: number;
    };
  };
  error?: Error | null;
  getWalletBalance?: () => number;
  getWalletVerdict?: (options?: { holdUnsettled?: boolean }) => {
    walletPrimaryUnknown?: boolean;
  };
  isFetchingNow?: () => boolean;
  isLoading?: boolean;
  isRefetching?: boolean;
  refetch: jest.Mock;
};

jest.mock('@/hooks/useMerchantPaymentSettings', () => ({
  useMerchantPaymentSettings: () => mockUseMerchantPaymentSettings(),
}));

let mockCapability: boolean | null = null;
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: () => mockCapability,
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
    clearObservedPiggyvestPrimaryCapability();
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
    mockCapability = false;
    observePiggyvestPrimaryCapability('merchant-1', false);
    mockWalletQuery = {
      ...baseWalletQuery(),
      data: { wallet: { balance: 0 } },
    };

    const { result } = renderHook(() => useUtilityPayment());
    mockCapability = null;

    expect(result.current.walletPrimaryUnknown).toBeUndefined();
  });

  it("keeps today's funding through a refresh where the server rules PiggyVest out", () => {
    mockCapability = false;
    observePiggyvestPrimaryCapability('merchant-1', false);
    mockWalletQuery = {
      ...baseWalletQuery(),
      data: { wallet: { balance: 0 } },
      isRefetching: true,
    };

    const { result } = renderHook(() => useUtilityPayment());
    mockCapability = null;

    expect(result.current.walletPrimaryUnknown).toBeUndefined();
  });
});

describe('bugfix: utility bank transfers offered before the wallet owner resolves', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearObservedPiggyvestPrimaryCapability();
    mockUseMerchantPaymentSettings.mockReturnValue({
      data: { wallet_paystack_dva_enabled: true },
    });
  });

  it('holds bank-transfer funding for a user with no customer row yet', () => {
    // Arrange: settled empty wallet, no customer row, PiggyVest possible.
    mockCapability = null;
    mockWalletQuery = {
      ...baseWalletQuery(),
      data: { wallet: { balance: 0, owner_unresolved: true } },
    };

    // Act
    const { result } = renderHook(() => useUtilityPayment());

    // Assert
    expect(result.current.walletPrimaryUnknown).toBe(true);
  });

  it('asks the live verdict to hold an unresolved owner where PiggyVest is possible', () => {
    mockCapability = null;
    const getWalletVerdict = jest.fn(() => ({ walletPrimaryUnknown: true }));
    mockWalletQuery = {
      ...baseWalletQuery(),
      data: { wallet: { balance: 0, owner_unresolved: true } },
      getWalletVerdict,
    };

    const { result } = renderHook(() => useUtilityPayment());
    result.current.getWalletVerdict?.();

    expect(getWalletVerdict).toHaveBeenCalledWith({ holdUnsettled: true });
  });

  it("keeps today's funding for an unresolved owner where the server rules PiggyVest out", () => {
    mockCapability = false;
    observePiggyvestPrimaryCapability('merchant-1', false);
    mockWalletQuery = {
      ...baseWalletQuery(),
      data: { wallet: { balance: 0, owner_unresolved: true } },
    };

    const { result } = renderHook(() => useUtilityPayment());
    mockCapability = null;

    expect(result.current.walletPrimaryUnknown).toBeUndefined();
  });
});

describe('bugfix: restored legacy wallet trusted before the PiggyVest verdict', () => {
  beforeEach(() => {
    clearObservedPiggyvestPrimaryCapability();
  });
  afterEach(() => {
    clearObservedPiggyvestPrimaryCapability();
    mockCapability = null;
  });

  it('holds bank-transfer funding until the merchant verdict is known', () => {
    // Arrange: cold start, legacy wallet restored, probe not answered.
    mockUseMerchantPaymentSettings.mockReturnValue({
      data: { wallet_paystack_dva_enabled: true },
    });
    mockCapability = null;
    mockWalletQuery = {
      ...baseWalletQuery(),
      data: { wallet: { balance: 0 } },
    };

    // Act
    const { result } = renderHook(() => useUtilityPayment());

    // Assert
    expect(result.current.walletPrimaryUnknown).toBe(true);
  });
});

describe('bugfix: stale render-time capability at utility submit', () => {
  afterEach(() => {
    clearObservedPiggyvestPrimaryCapability();
    mockCapability = null;
  });

  it('holds an unresolved owner once the cached ruling-out has expired', () => {
    // Arrange: rendered as ruled out; by submit no verdict is current.
    mockCapability = false;
    const getWalletVerdict = jest.fn(() => ({ walletPrimaryUnknown: true }));
    mockWalletQuery = {
      ...baseWalletQuery(),
      data: { wallet: { balance: 0, owner_unresolved: true } },
      getWalletVerdict,
    };
    const { result } = renderHook(() => useUtilityPayment());

    // Act
    result.current.getWalletVerdict?.();

    // Assert
    expect(getWalletVerdict).toHaveBeenCalledWith({ holdUnsettled: true });
  });

  it("keeps today's funding while the ruling-out is current", () => {
    observePiggyvestPrimaryCapability('merchant-1', false);
    mockCapability = false;
    const getWalletVerdict = jest.fn(() => ({ walletPrimaryUnknown: false }));
    mockWalletQuery = {
      ...baseWalletQuery(),
      data: { wallet: { balance: 0, owner_unresolved: true } },
      getWalletVerdict,
    };
    const { result } = renderHook(() => useUtilityPayment());

    result.current.getWalletVerdict?.();

    expect(getWalletVerdict).toHaveBeenCalledWith({ holdUnsettled: false });
  });

  it('bugfix: reports unknown when the ruling-out expired before reclassification', () => {
    // Arrange: rendered as ruled out; the negative verdict has expired.
    mockCapability = false;
    mockWalletQuery = {
      ...baseWalletQuery(),
      data: { wallet: { balance: 0 } },
      getWalletVerdict: () => ({ walletPrimaryUnknown: false }),
    };
    const { result } = renderHook(() => useUtilityPayment());

    // Act
    const verdict = result.current.getWalletVerdict?.();

    // Assert
    expect(verdict?.walletPrimaryUnknown).toBe(true);
  });
});
