// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const keyboard = vi.hoisted(() => ({
  isIos: true,
  listeners: new Map<string, () => void>(),
  remove: vi.fn(),
  visible: false,
}));

vi.mock('react-native', () => ({
  Keyboard: {
    addListener: (event: string, listener: () => void) => {
      keyboard.listeners.set(event, listener);
      return { remove: keyboard.remove };
    },
    isVisible: () => keyboard.visible,
  },
}));

vi.mock('@/config/runtime-platform', () => ({
  isRuntimePlatform: () => keyboard.isIos,
}));

import { useKeyboardShown } from './useKeyboardShown';

describe('useKeyboardShown', () => {
  beforeEach(() => {
    keyboard.isIos = true;
    keyboard.listeners.clear();
    keyboard.remove.mockReset();
    keyboard.visible = false;
  });

  it('starts from the current keyboard visibility', () => {
    keyboard.visible = true;
    const { result } = renderHook(() => useKeyboardShown());
    expect(result.current).toBe(true);
  });

  it('follows the iOS will-show and will-hide events', () => {
    const { result } = renderHook(() => useKeyboardShown());
    expect(result.current).toBe(false);

    act(() => keyboard.listeners.get('keyboardWillShow')?.());
    expect(result.current).toBe(true);

    act(() => keyboard.listeners.get('keyboardWillHide')?.());
    expect(result.current).toBe(false);
  });

  it('stays shown when the keyboard is reported again during a field switch', () => {
    const { result } = renderHook(() => useKeyboardShown());

    act(() => keyboard.listeners.get('keyboardWillShow')?.());
    act(() => keyboard.listeners.get('keyboardWillShow')?.());

    expect(result.current).toBe(true);
  });

  it('uses the did-show and did-hide events on Android', () => {
    keyboard.isIos = false;
    const { result } = renderHook(() => useKeyboardShown());

    act(() => keyboard.listeners.get('keyboardDidShow')?.());
    expect(result.current).toBe(true);

    act(() => keyboard.listeners.get('keyboardDidHide')?.());
    expect(result.current).toBe(false);
    expect(keyboard.listeners.has('keyboardWillShow')).toBe(false);
    expect(keyboard.listeners.has('keyboardWillHide')).toBe(false);
  });

  it('removes both listeners on unmount', () => {
    const { unmount } = renderHook(() => useKeyboardShown());
    unmount();
    expect(keyboard.remove).toHaveBeenCalledTimes(2);
  });
});
