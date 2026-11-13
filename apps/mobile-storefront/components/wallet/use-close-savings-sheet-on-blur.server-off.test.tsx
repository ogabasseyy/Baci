import { act, renderHook } from '@testing-library/react-native';
import { useCloseSavingsSheetOnBlur } from './use-close-savings-sheet-on-blur';

let mockBlur: (() => void) | undefined;
let mockFocused = false;
jest.mock('expo-router', () => ({
  // Runs the focus effect once (the first focus), like the real hook.
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    if (mockFocused) return;
    mockFocused = true;
    mockBlur = effect() ?? undefined;
  },
}));

beforeEach(() => {
  mockFocused = false;
  mockBlur = undefined;
});

// Local navigation state only: nothing here needs PiggyVest.
describe('server keeps PiggyVest off: useCloseSavingsSheetOnBlur', () => {
  it('runs the sheet close when the wallet loses focus with the sheet open', () => {
    const close = jest.fn();
    renderHook(() => useCloseSavingsSheetOnBlur(true, close));
    expect(close).not.toHaveBeenCalled();
    mockBlur?.();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does nothing on blur while the sheet is closed', () => {
    const close = jest.fn();
    renderHook(() => useCloseSavingsSheetOnBlur(false, close));
    mockBlur?.();
    expect(close).not.toHaveBeenCalled();
  });

  it('uses the latest close handler', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = renderHook(
      ({ close }: { close: () => void }) =>
        useCloseSavingsSheetOnBlur(true, close),
      { initialProps: { close: first } }
    );
    rerender({ close: second });
    mockBlur?.();
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
    act(() => mockBlur?.());
    expect(close).not.toHaveBeenCalled();
    rerender({ locked: false });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
