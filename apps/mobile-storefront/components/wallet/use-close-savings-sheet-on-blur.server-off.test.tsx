import { act, renderHook } from '@testing-library/react-native';
import { useCloseSavingsSheetOnBlur } from './use-close-savings-sheet-on-blur';

const mockListeners: Record<string, Array<() => void>> = {};
const mockNavigation = {
  addListener: (event: string, listener: () => void) => {
    mockListeners[event] = [...(mockListeners[event] ?? []), listener];
    return () => {
      mockListeners[event] = (mockListeners[event] ?? []).filter(
        (item) => item !== listener
      );
    };
  },
};
jest.mock('expo-router', () => ({ useNavigation: () => mockNavigation }));

const emit = (event: string) =>
  act(() => {
    for (const listener of mockListeners[event] ?? []) listener();
  });

beforeEach(() => {
  for (const key of Object.keys(mockListeners)) delete mockListeners[key];
});

// Local navigation state only: nothing here needs PiggyVest.
describe('server keeps PiggyVest off: useCloseSavingsSheetOnBlur', () => {
  it('never closes an open sheet just because it re-renders', () => {
    const close = jest.fn();
    const { rerender } = renderHook(
      ({ handler }: { handler: () => void }) =>
        useCloseSavingsSheetOnBlur(true, handler),
      { initialProps: { handler: close } }
    );
    rerender({ handler: () => close() });
    rerender({ handler: () => close() });
    expect(close).not.toHaveBeenCalled();
  });

  it('runs the sheet close when the wallet loses focus with the sheet open', () => {
    const close = jest.fn();
    renderHook(() => useCloseSavingsSheetOnBlur(true, close));
    emit('blur');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does nothing on blur while the sheet is closed', () => {
    const close = jest.fn();
    renderHook(() => useCloseSavingsSheetOnBlur(false, close));
    emit('blur');
    expect(close).not.toHaveBeenCalled();
  });

  it('uses the latest close handler', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = renderHook(
      ({ handler }: { handler: () => void }) =>
        useCloseSavingsSheetOnBlur(true, handler),
      { initialProps: { handler: first } }
    );
    rerender({ handler: second });
    emit('blur');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('waits for a locked send to settle before closing', () => {
    const close = jest.fn();
    const { rerender } = renderHook(
      ({ locked }: { locked: boolean }) =>
        useCloseSavingsSheetOnBlur(true, close, locked),
      { initialProps: { locked: true } }
    );
    emit('blur');
    expect(close).not.toHaveBeenCalled();
    rerender({ locked: false });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
