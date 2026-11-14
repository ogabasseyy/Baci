import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useStartSavingsController } from './use-start-savings-controller';

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('@/hooks/use-debounce', () => ({ useDebounce: (v: string) => v }));
jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({ products: [], isLoading: false }),
}));
// PiggyVest main wallet ready with ₦5,000; legacy wallet empty.
jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({
    data: {
      wallet: {
        balance: 0,
        primary_balance_kobo: 500000,
        funding_account: null,
      },
      transactions: [],
    },
    isRefetching: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ merchantId: 'merchant-1', user: { id: 'user-a' } }),
}));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'merchant-1', MERCHANT_SLUG: 'ogabassey' },
}));
jest.mock('./use-start-savings-payment-methods', () => ({
  useStartSavingsPaymentMethods: () => ({ setPaymentMethodsError: jest.fn() }),
}));
jest.mock('./use-start-savings-submit', () => ({
  useStartSavingsSubmit: () => ({}),
}));
jest.mock('./use-savings-plan-funding', () => ({
  useSavingsPlanFunding: () => ({}),
}));

// A PiggyVest customer's head start is moved through PiggyVest after the
// plan exists (the creation call itself can only debit the legacy wallet), so
// the flow advertises the PiggyVest balance the money will really come from.
describe('start-savings balance with the PiggyVest wallet ready', () => {
  it('shows the PiggyVest balance, not the empty legacy one', () => {
    const { result } = renderHook(() => useStartSavingsController());
    expect(result.current.safeWalletBalance).toBe(5000);
  });
});
