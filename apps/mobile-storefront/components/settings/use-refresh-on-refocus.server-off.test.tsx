import { act, renderHook } from '@testing-library/react-native';
import { useRefreshOnRefocus } from './use-refresh-on-refocus';

const mockListeners: Record<string, Array<() => void>> = {};
jest.mock('expo-router', () => ({
  useNavigation: () => ({
    addListener: (event: string, listener: () => void) => {
      mockListeners[event] = [...(mockListeners[event] ?? []), listener];
      return () => undefined;
    },
  }),
}));

const emit = (event: string) =>
  act(() => {
    for (const listener of mockListeners[event] ?? []) listener();
  });

beforeEach(() => {
  for (const key of Object.keys(mockListeners)) delete mockListeners[key];
});

// Local navigation only: nothing here needs PiggyVest.
describe('server keeps PiggyVest off: useRefreshOnRefocus', () => {
  it('refreshes on the first return after leaving (initial focus is never replayed)', () => {
    const refresh = jest.fn();
    renderHook(() => useRefreshOnRefocus(refresh));
    emit('blur');
    emit('focus');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on a focus without a blur first', () => {
    const refresh = jest.fn();
    renderHook(() => useRefreshOnRefocus(refresh));
    emit('focus');
    expect(refresh).not.toHaveBeenCalled();
  });
});
