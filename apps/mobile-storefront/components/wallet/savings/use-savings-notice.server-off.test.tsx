import { act, renderHook } from '@testing-library/react-native';
import { useAuthStore } from '@/stores/auth-store';
import { notifySavings } from './notify-savings';
import { useSavingsNoticeStore } from './savings-notice-store';
import { useSavingsNotice } from './use-savings-notice';

describe('server keeps PiggyVest off: useSavingsNotice', () => {
  beforeEach(() => {
    act(() => {
      useAuthStore.setState({
        user: { id: 'u-1' } as never,
        merchantId: 'm-1',
      });
      useSavingsNoticeStore.setState({ notice: null, goalId: null });
    });
  });

  it("clears goal A's notice when the sheet moves to goal B", () => {
    const { result, rerender } = renderHook(
      ({ goalId }: { goalId: string | null }) => useSavingsNotice(goalId),
      { initialProps: { goalId: 'goal-a' as string | null } }
    );
    act(() => notifySavings('Savings updated', '₦5,000 added to goal A'));
    expect(result.current.notice?.title).toBe('Savings updated');
    rerender({ goalId: 'goal-b' });
    expect(result.current.notice).toBeNull();
  });

  it('keeps a carried success through one goal switch, then drops it', () => {
    const { result, rerender } = renderHook(
      ({ goalId }: { goalId: string | null }) => useSavingsNotice(goalId),
      { initialProps: { goalId: 'goal-a' as string | null } }
    );
    act(() => {
      useSavingsNoticeStore.setState({
        notice: {
          title: 'Goal reached! 🎉',
          tone: 'success',
          scope: 'u-1:m-1',
          carry: true,
        },
      });
    });
    rerender({ goalId: 'goal-b' });
    expect(result.current.notice?.title).toBe('Goal reached! 🎉');
    rerender({ goalId: 'goal-c' });
    expect(result.current.notice).toBeNull();
  });

  it('keeps an outcome when the goal leaves the wallet (no goal on screen)', () => {
    const { result, rerender } = renderHook(
      ({ goalId }: { goalId: string | null }) => useSavingsNotice(goalId),
      { initialProps: { goalId: 'goal-a' as string | null } }
    );
    act(() => notifySavings('Goal cancelled', 'Back in your wallet'));
    rerender({ goalId: null });
    expect(result.current.notice?.title).toBe('Goal cancelled');
  });

  it('a notice raised before the first goal is shown stays visible', () => {
    act(() => notifySavings('Savings updated'));
    const { result } = renderHook(() => useSavingsNotice('goal-a'));
    expect(result.current.notice?.title).toBe('Savings updated');
  });
});
