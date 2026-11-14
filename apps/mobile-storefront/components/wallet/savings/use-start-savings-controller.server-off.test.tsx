import { renderHook } from '@testing-library/react-native';
import { useStartSavingsController } from './use-start-savings-controller';

const mockPlanFunding = jest.fn((_input: unknown) => ({
  fetchExistingPlanFunding: jest.fn(),
  fetchPlanFunding: jest.fn(),
  fundingError: null,
  planFundingPhase: 'idle',
  planFundingStatusCode: null,
  planFundingRequiresBvn: true,
}));

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('@/hooks/use-debounce', () => ({ useDebounce: (v: string) => v }));
jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({ products: [], isLoading: false }),
}));
jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({ data: null, isRefetching: false, refetch: jest.fn() }),
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
  useSavingsPlanFunding: (input: unknown) => mockPlanFunding(input),
}));

// The setup flow starts as today's: no goal, no automatic status read for the
// plan, and the legacy BVN prompt stays on.
describe('server keeps PiggyVest off', () => {
  it('starts with no goal and does not ask the plan hook to look one up', () => {
    const { result } = renderHook(() => useStartSavingsController());
    expect(result.current.createdGoalId).toBeNull();
    expect(result.current.planFundingPhase).toBe('idle');
    expect(result.current.planFundingRequiresBvn).toBe(true);
    const asked = mockPlanFunding.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(asked.goalId).toBeNull();
    expect(asked.loadExisting).toBeUndefined();
  });
});
