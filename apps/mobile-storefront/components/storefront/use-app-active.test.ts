import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useAppActive } from './use-app-active';

const originalState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
afterEach(() => {
  jest.restoreAllMocks();
  if (originalState)
    Object.defineProperty(AppState, 'currentState', originalState);
});

describe('useAppActive', () => {
  it('catches up a transition during subscription and removes its listener on unmount', () => {
    let current: AppStateStatus = 'active';
    let listener: ((state: AppStateStatus) => void) | undefined;
    const remove = jest.fn();
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      get: () => current,
    });
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, callback) => {
        listener = callback as (state: AppStateStatus) => void;
        current = 'background';
        return { remove };
      });
    const view = renderHook(() => useAppActive());
    expect(view.result.current).toBe(false);
    act(() => {
      listener?.('active');
    });
    expect(view.result.current).toBe(true);
    view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
