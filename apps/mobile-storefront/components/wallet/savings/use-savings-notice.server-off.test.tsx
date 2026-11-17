import { act, renderHook } from '@testing-library/react-native';
import { useAuthStore } from '@/stores/auth-store';
import { notifySavings } from './notify-savings';
import { useSavingsNoticeStore } from './savings-notice-store';
import { SUCCESS_NOTICE_MS, useSavingsNotice } from './use-savings-notice';

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

  describe('success notices are brief (owner, 2026-11-17)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('clears "Savings updated" by itself after a few seconds', () => {
      const { result } = renderHook(() => useSavingsNotice('goal-a'));
      act(() => notifySavings('Savings updated', 'Nice!', 'success'));
      expect(result.current.notice?.title).toBe('Savings updated');
      act(() => jest.advanceTimersByTime(SUCCESS_NOTICE_MS));
      expect(result.current.notice).toBeNull();
    });

    it('keeps a pending or warning notice until it is closed', () => {
      const { result } = renderHook(() => useSavingsNotice('goal-a'));
      act(() => notifySavings('Contribution pending', 'Still waiting', 'info'));
      act(() => jest.advanceTimersByTime(SUCCESS_NOTICE_MS * 4));
      expect(result.current.notice?.title).toBe('Contribution pending');
    });
  });
});
