import { act } from '@testing-library/react-native';
import { useAuthStore } from '@/stores/auth-store';
import { notifySavings } from './notify-savings';
import { useSavingsNoticeStore } from './savings-notice-store';

describe('server keeps PiggyVest off: notifySavings', () => {
  it('shows an info notice for the customer and store signed in now', () => {
    act(() => {
      useAuthStore.setState({
        user: { id: 'u-1' } as never,
        merchantId: 'm-1',
      });
    });
    act(() => notifySavings('Contribution pending', 'Waiting on PiggyVest.'));
    expect(useSavingsNoticeStore.getState().notice).toEqual({
      title: 'Contribution pending',
      message: 'Waiting on PiggyVest.',
      tone: 'info',
      scope: 'u-1:m-1',
    });
  });
});
