import { act, renderHook } from '@testing-library/react-native';
import { useRefreshOnRefocus } from './use-refresh-on-refocus';

const mockFocus: Array<() => void> = [];
jest.mock('expo-router', () => ({
  useNavigation: () => ({
    addListener: (_event: string, listener: () => void) => {
      mockFocus.push(listener);
      return () => undefined;
    },
  }),
}));

// Local navigation only: nothing here needs PiggyVest.
describe('server keeps PiggyVest off: useRefreshOnRefocus', () => {
  it('refreshes when the screen comes back, not on the first focus', () => {
    const refresh = jest.fn();
    renderHook(() => useRefreshOnRefocus(refresh));
    act(() => {
      for (const listener of mockFocus) listener();
    });
    expect(refresh).not.toHaveBeenCalled();
    act(() => {
      for (const listener of mockFocus) listener();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
