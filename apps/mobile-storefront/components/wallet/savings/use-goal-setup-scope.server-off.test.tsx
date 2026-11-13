import { renderHook } from '@testing-library/react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { useGoalSetupScope } from './use-goal-setup-scope';

let mockPrimary = false;
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: 'merchant-1' } }));
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: () => mockPrimary,
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { id: 'user-1' }, merchantId: 'merchant-1' }),
}));

const goal = (change: Partial<WalletActiveSavingsGoal> = {}) =>
  ({
    id: 'goal-1',
    source_mode: 'manual',
    status: 'active',
    ...change,
  }) as WalletActiveSavingsGoal;
const scope = (g: WalletActiveSavingsGoal | null) =>
  renderHook(() => useGoalSetupScope(g)).result.current;

describe('useGoalSetupScope', () => {
  it('with PiggyVest off, checks nothing', () => {
    mockPrimary = false;
    expect(scope(goal()).checked).toBe(false);
  });

  it('checks an active manual plan on a primary merchant, keyed per account', () => {
    mockPrimary = true;
    expect(scope(goal())).toEqual({
      checked: true,
      merchantId: 'merchant-1',
      scopeKey: JSON.stringify(['user-1', 'merchant-1', 'goal-1']),
      userId: 'user-1',
    });
  });

  it('skips auto-debit, finished plans and no plan', () => {
    mockPrimary = true;
    expect(scope(goal({ source_mode: 'auto_debit' })).checked).toBe(false);
    expect(scope(goal({ status: 'completed' })).checked).toBe(false);
    expect(scope(null).checked).toBe(false);
  });
});
