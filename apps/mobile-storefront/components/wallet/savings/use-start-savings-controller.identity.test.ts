import { beforeEach, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useStartSavingsController } from './use-start-savings-controller';

let mockUserId: string | undefined = 'user-a';
const mockUseProducts = jest.fn((..._args: unknown[]) => ({
  products: [],
  isLoading: false,
}));
const mockUseWallet = jest.fn(() => ({
  data: null,
  isRefetching: false,
  refetch: jest.fn(),
}));
const mockPlanFunding = jest.fn((_input: unknown) => ({
  fetchExistingPlanFunding: jest.fn(),
  fetchPlanFunding: jest.fn(),
  fundingError: null,
  planFundingAccounts: [],
  planFundingPhase: 'idle',
  planFundingStatusCode: null,
  planFundingRequiresBvn: true,
}));
let capturedSetCreatedGoalId: ((goalId: string | null) => void) | null = null;

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('@/hooks/use-debounce', () => ({ useDebounce: (v: string) => v }));
jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: (...args: unknown[]) => mockUseProducts(...args),
}));
jest.mock('@/hooks/use-wallet', () => ({ useWallet: () => mockUseWallet() }));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: {
      merchantId: string | null;
      user?: { id: string };
    }) => unknown
  ) =>
    selector({
      merchantId: 'merchant-1',
      user: mockUserId ? { id: mockUserId } : undefined,
    }),
}));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'merchant-1', MERCHANT_SLUG: 'ogabassey' },
}));
jest.mock('./use-start-savings-payment-methods', () => ({
  useStartSavingsPaymentMethods: () => ({
    setPaymentMethodsError: jest.fn(),
  }),
}));
jest.mock('./use-start-savings-submit', () => ({
  useStartSavingsSubmit: (input: {
    setCreatedGoalId: (goalId: string | null) => void;
  }) => {
    capturedSetCreatedGoalId = input.setCreatedGoalId;
    return {};
  },
}));
jest.mock('./use-savings-plan-funding', () => ({
  useSavingsPlanFunding: (input: unknown) => mockPlanFunding(input),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'user-a';
  capturedSetCreatedGoalId = null;
});

it('scopes the plan-funding hook to the signed-in user', () => {
  renderHook(() => useStartSavingsController());
  expect(mockPlanFunding).toHaveBeenCalledWith(
    expect.objectContaining({ identityKey: 'user-a' })
  );
});

it('resets server-bound savings state when the account changes without unmounting', () => {
  const { result, rerender } = renderHook(() => useStartSavingsController());
  act(() => {
    capturedSetCreatedGoalId?.('goal-a');
  });
  expect(result.current.createdGoalId).toBe('goal-a');
  expect(mockPlanFunding).toHaveBeenLastCalledWith(
    expect.objectContaining({ goalId: 'goal-a', identityKey: 'user-a' })
  );

  mockUserId = 'user-b';
  rerender({});

  expect(result.current.createdGoalId).toBeNull();
  expect(mockPlanFunding).toHaveBeenLastCalledWith(
    expect.objectContaining({ goalId: null, identityKey: 'user-b' })
  );
});
