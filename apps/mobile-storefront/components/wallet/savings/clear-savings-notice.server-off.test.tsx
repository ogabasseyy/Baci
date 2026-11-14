import { act } from '@testing-library/react-native';
import { clearSavingsNotice } from './clear-savings-notice';
import { useSavingsNoticeStore } from './savings-notice-store';

describe('server keeps PiggyVest off: clearSavingsNotice', () => {
  it('drops the current notice', () => {
    act(() => {
      useSavingsNoticeStore.setState({
        notice: { title: 'Savings updated', tone: 'success' },
      });
    });
    act(() => clearSavingsNotice());
    expect(useSavingsNoticeStore.getState().notice).toBeNull();
  });
});
