import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Keyboard, type KeyboardEvent, Platform } from 'react-native';
import { useKeyboard } from './use-keyboard';

function keyboardEvent(screenY: number, height: number): KeyboardEvent {
  return {
    duration: 0,
    easing: 'keyboard',
    endCoordinates: {
      height,
      screenX: 0,
      screenY,
      width: 390,
    },
  };
}

describe('useKeyboard', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exposes shared keyboard visibility, height, and screen position', () => {
    let showListener: Parameters<typeof Keyboard.addListener>[1] | undefined;
    let hideListener: Parameters<typeof Keyboard.addListener>[1] | undefined;
    jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation((event, listener) => {
        if (event.endsWith('Show')) showListener = listener;
        if (event.endsWith('Hide')) hideListener = listener;
        return { remove: jest.fn() } as unknown as ReturnType<
          typeof Keyboard.addListener
        >;
      });

    const { result } = renderHook(() => useKeyboard());

    expect(Keyboard.addListener).toHaveBeenCalledWith(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      expect.any(Function)
    );
    expect(result.current.keyboardTop).toBeNull();

    act(() => showListener?.(keyboardEvent(600, 244)));
    expect(result.current).toMatchObject({
      isKeyboardVisible: true,
      keyboardHeight: 244,
      keyboardTop: 600,
    });

    act(() => hideListener?.(keyboardEvent(844, 0)));
    expect(result.current).toMatchObject({
      isKeyboardVisible: false,
      keyboardHeight: 0,
      keyboardTop: null,
    });
  });
});
it('updates the docking geometry when keyboard frame changes during rotation', () => {
  const listeners: Record<string, (event: KeyboardEvent) => void> = {};
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, callback) => {
    listeners[name] = callback;
    return { remove: jest.fn() } as unknown as ReturnType<
      typeof Keyboard.addListener
    >;
  });
  const { result } = renderHook(() => useKeyboard());
  act(() =>
    listeners[Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'](
      keyboardEvent(600, 244)
    )
  );
  act(() => listeners.keyboardWillChangeFrame(keyboardEvent(190, 200)));
  expect(result.current.keyboardTop).toBe(190);
  expect(result.current.keyboardHeight).toBe(200);
  expect(result.current.isKeyboardVisible).toBe(true);
});
