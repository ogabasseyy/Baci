// @vitest-environment jsdom

import { focusManager } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const appStateMocks = vi.hoisted(() => ({
  addEventListener: vi.fn(),
  currentState: 'background',
  remove: vi.fn(),
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: appStateMocks.addEventListener,
    get currentState() {
      return appStateMocks.currentState;
    },
  },
}));

import { useReactQueryAppFocus } from './useReactQueryAppFocus';

describe('useReactQueryAppFocus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appStateMocks.currentState = 'background';
    appStateMocks.addEventListener.mockReturnValue({
      remove: appStateMocks.remove,
    });
    vi.spyOn(focusManager, 'setFocused');
  });

  it('sets the initial app state and tracks active and inactive transitions', () => {
    // Arrange
    const { unmount } = renderHook(() => useReactQueryAppFocus());
    const listener = appStateMocks.addEventListener.mock.calls[0]?.[1];
    expect(listener).toBeTypeOf('function');

    // Act
    listener('active');
    listener('inactive');
    listener('background');

    // Assert
    expect(appStateMocks.addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    );
    expect(focusManager.setFocused).toHaveBeenNthCalledWith(1, false);
    expect(focusManager.setFocused).toHaveBeenNthCalledWith(2, true);
    expect(focusManager.setFocused).toHaveBeenNthCalledWith(3, false);
    expect(focusManager.setFocused).toHaveBeenNthCalledWith(4, false);
    unmount();
  });

  it('removes the exact AppState subscription on unmount', () => {
    // Arrange
    const { unmount } = renderHook(() => useReactQueryAppFocus());

    // Act
    unmount();

    // Assert
    expect(appStateMocks.remove).toHaveBeenCalledOnce();
  });
});
