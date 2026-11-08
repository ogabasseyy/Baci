import { Keyboard } from 'react-native';
import { dismissKeyboardForNavigation } from './dismiss-keyboard-for-navigation';

const mockVisible = jest.fn(() => true);
const mockRemove = jest.fn();
const mockEvents = new Map<string, () => void>();
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardController: { isVisible: () => mockVisible() },
  KeyboardEvents: {
    addListener: (name: string, listener: () => void) => {
      mockEvents.set(name, listener);
      return {
        remove: () => {
          mockRemove();
          mockEvents.delete(name);
        },
      };
    },
  },
}));
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockEvents.clear();
  mockVisible.mockReturnValue(true);
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
it('waits for the controller hide event and a layout frame before allowing navigation', async () => {
  let done = false;
  const promise = dismissKeyboardForNavigation().then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(Keyboard.dismiss).toHaveBeenCalledTimes(1);
  expect(done).toBe(false);
  mockEvents.get('keyboardDidHide')?.();
  await Promise.resolve();
  expect(done).toBe(false);
  jest.advanceTimersByTime(16);
  await promise;
  expect(done).toBe(true);
  expect(mockRemove).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
it('does not delay navigation when the keyboard is already hidden', async () => {
  mockVisible.mockReturnValue(false);
  await dismissKeyboardForNavigation();
  expect(mockEvents.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});
it('cleans up and releases navigation if the device never emits keyboardDidHide', async () => {
  const promise = dismissKeyboardForNavigation();
  jest.advanceTimersByTime(700);
  await promise;
  expect(mockRemove).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
it('releases navigation if layout frames are suspended after hiding', async () => {
  const raf = jest.spyOn(global, 'requestAnimationFrame').mockReturnValue(123);
  const promise = dismissKeyboardForNavigation();
  mockEvents.get('keyboardDidHide')?.();
  jest.advanceTimersByTime(50);
  await promise;
  expect(mockRemove).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  raf.mockRestore();
});
