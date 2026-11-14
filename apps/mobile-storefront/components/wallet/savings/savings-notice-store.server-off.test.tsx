import { act } from '@testing-library/react-native';
import { useSavingsNoticeStore } from './savings-notice-store';

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
});
