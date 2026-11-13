import { act } from '@testing-library/react-native';
import { useAuthStore } from '@/stores/auth-store';
import {
  currentSavingsNoticeScope,
  useSavingsNoticeStore,
} from './savings-notice-store';

// Local UI state only: nothing here needs PiggyVest.
describe('server keeps PiggyVest off: savings notice store', () => {
  it('starts with no notice and no goal, and clear() empties it', () => {
    expect(useSavingsNoticeStore.getState().goalId).toBeNull();
    act(() => {
      useSavingsNoticeStore.setState({
        notice: { title: 'x', tone: 'info' },
      });
    });
    act(() => useSavingsNoticeStore.getState().clear());
    expect(useSavingsNoticeStore.getState().notice).toBeNull();
  });

  it('scopes notices by the signed-in customer and store', () => {
    act(() => {
      useAuthStore.setState({
        user: { id: 'u-1' } as never,
        merchantId: 'm-1',
      });
    });
    expect(currentSavingsNoticeScope()).toBe('u-1:m-1');
  });
});
