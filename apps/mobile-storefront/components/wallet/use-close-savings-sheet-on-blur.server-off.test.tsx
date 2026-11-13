import { renderHook } from '@testing-library/react-native';
import { useCloseSavingsSheetOnBlur } from './use-close-savings-sheet-on-blur';

let mockBlur: (() => void) | undefined;
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    mockBlur = effect() ?? undefined;
  },
}));

// Local navigation state only: nothing here needs PiggyVest.
describe('server keeps PiggyVest off: useCloseSavingsSheetOnBlur', () => {
  it('closes the savings sheet when the wallet loses focus', () => {
    const setShow = jest.fn();
    renderHook(() => useCloseSavingsSheetOnBlur(setShow));
    expect(setShow).not.toHaveBeenCalled();
    mockBlur?.();
    expect(setShow).toHaveBeenCalledWith(false);
  });
});
