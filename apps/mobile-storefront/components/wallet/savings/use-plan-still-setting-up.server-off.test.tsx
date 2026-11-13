import { act, renderHook } from '@testing-library/react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import {
  rememberGoalSetupPhase,
  resetGoalSetupMemory,
} from './goal-setup-memory';
import { usePlanStillSettingUp } from './use-plan-still-setting-up';

let mockPrimary = true;
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: 'merchant-1' } }));
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: () => mockPrimary,
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { id: 'user-1' }, merchantId: 'merchant-1' }),
}));

const goal = {
  id: 'goal-1',
  source_mode: 'manual',
  status: 'active',
} as WalletActiveSavingsGoal;
const scopeKey = JSON.stringify(['user-1', 'merchant-1', 'goal-1']);

beforeEach(() => {
  resetGoalSetupMemory();
  mockPrimary = true;
});

describe('usePlanStillSettingUp', () => {
  it('with PiggyVest off, never holds back the Add to savings title', () => {
    mockPrimary = false;
    const { result } = renderHook(() => usePlanStillSettingUp(goal));
    expect(result.current).toBe(false);
  });

  it('is false with no plan', () => {
    const { result } = renderHook(() => usePlanStillSettingUp(null));
    expect(result.current).toBe(false);
  });

  describe('bugfix: the sheet said Add to savings while the card said View plan', () => {
    it('stays true until the plan is known ready, then follows the update', () => {
      const { result } = renderHook(() => usePlanStillSettingUp(goal));
      expect(result.current).toBe(true);
      act(() => rememberGoalSetupPhase(scopeKey, 'pending'));
      expect(result.current).toBe(true);
      act(() => rememberGoalSetupPhase(scopeKey, 'ready'));
      expect(result.current).toBe(false);
    });
  });
});
