import { renderHook } from '@testing-library/react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { useGoalCardSetupState } from './use-goal-card-setup-state';

const mockFetch = jest.fn();
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: () => false,
}));
jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: (...args: unknown[]) => mockFetch(...args),
  fetchSavingsPlanFunding: jest.fn(),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { id: 'user-1' }, merchantId: 'merchant-1' }),
}));

it('with PiggyVest off, leaves the card as it was and reads no plan status', () => {
  const goal = {
    id: 'goal-1',
    source_mode: 'manual',
    status: 'active',
  } as WalletActiveSavingsGoal;
  const { result } = renderHook(() => useGoalCardSetupState(goal));
  expect(result.current).toBeNull();
  expect(mockFetch).not.toHaveBeenCalled();
});
