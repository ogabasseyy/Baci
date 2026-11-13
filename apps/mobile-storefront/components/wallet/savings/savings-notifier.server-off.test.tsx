import { act } from '@testing-library/react-native';
import { useAuthStore } from '@/stores/auth-store';
import { useSavingsNoticeStore } from './savings-notice-store';
import { savingsNotifier } from './savings-notifier';

describe('server keeps PiggyVest off: savingsNotifier', () => {
  beforeEach(() => {
    act(() => {
      useAuthStore.setState({
        user: { id: 'u-1' } as never,
        merchantId: 'm-1',
      });
      useSavingsNoticeStore.setState({ notice: null, goalId: 'goal-a' });
    });
  });

  it('delivers when nothing changed', () => {
    const notify = savingsNotifier();
    act(() => notify('Savings updated', '₦5,000 added', 'success'));
    expect(useSavingsNoticeStore.getState().notice?.title).toBe(
      'Savings updated'
    );
  });

  it('drops a late notice after the store changed', () => {
    const notify = savingsNotifier();
    act(() => {
      useAuthStore.setState({ merchantId: 'm-2' });
    });
    act(() => notify('Savings updated'));
    expect(useSavingsNoticeStore.getState().notice).toBeNull();
  });

  it("drops goal A's late notice once the sheet shows goal B", () => {
    const notify = savingsNotifier();
    act(() => {
      useSavingsNoticeStore.setState({ goalId: 'goal-b' });
    });
    act(() => notify('Phone changed', 'iPhone 15 for goal A'));
    expect(useSavingsNoticeStore.getState().notice).toBeNull();
  });
});
