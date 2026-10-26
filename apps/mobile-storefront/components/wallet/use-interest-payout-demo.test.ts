import { act, renderHook } from '@testing-library/react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { hostedStorefrontRuntime } from '@/lib/hosted-storefront-runtime';
import { deriveWalletDisplayData } from './derive-wallet-display-data';
import { useInterestPayoutDemo } from './use-interest-payout-demo';

jest.mock('@/lib/hosted-storefront-runtime', () => ({
  hostedStorefrontRuntime: { read: jest.fn(() => ({})) },
}));

const goal: WalletActiveSavingsGoal = {
  id: 'goal-a',
  title: 'Phone',
  status: 'active',
  current_amount: 100,
  target_amount: 250000,
  contribution_amount: 100,
  contribution_frequency: 'monthly',
  maturity_date: '2027-01-01',
  source_mode: 'manual',
};
const display = deriveWalletDisplayData({
  active_savings_goal: goal,
  savings_balance: 300,
  balance: 0,
});

describe('sandbox app interest simulation', () => {
  beforeEach(() =>
    jest.mocked(hostedStorefrontRuntime.read).mockReturnValue({} as never)
  );

  it('updates goal, earnings, savings and total once without changing spendable funds or source data', () => {
    const { result } = renderHook(() =>
      useInterestPayoutDemo('owner-a', display)
    );
    act(() => result.current.simulate());
    expect(result.current.display).toMatchObject({
      savingsBalance: 307.33,
      totalBalance: 307.33,
      earningsBalance: 7.33,
      spendableBalance: 0,
      activeSavingsGoal: { current_amount: 107.33 },
    });
    act(() => result.current.simulate());
    expect(result.current.display?.totalBalance).toBe(307.33);
    expect(display.totalBalance).toBe(300);
    expect(goal.current_amount).toBe(100);
    act(() => result.current.reset());
    expect(result.current.display).toBe(display);
  });

  it('does not project another customer or goal and fails closed outside sandbox', () => {
    const { result, rerender } = renderHook(
      ({ owner }: { owner: string }) => useInterestPayoutDemo(owner, display),
      { initialProps: { owner: 'owner-a' } }
    );
    act(() => result.current.simulate());
    rerender({ owner: 'owner-b' });
    expect(result.current.active).toBe(false);
    expect(result.current.display).toBe(display);
    jest.mocked(hostedStorefrontRuntime.read).mockReturnValue(null);
    act(() => result.current.simulate());
    rerender({ owner: 'owner-a' });
    expect(result.current.active).toBe(false);
  });
});
