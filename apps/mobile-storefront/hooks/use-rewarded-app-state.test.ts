import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useRewardedAppState } from './use-rewarded-app-state';

describe('useRewardedAppState', () => {
  it('abandons a pending session when the app backgrounds', () => {
    // Arrange: a loaded-but-unpresented session holding ownership.
    const { result } = renderHook(() => {
      const sessionRef = useRef({
        cleanups: [] as Array<() => void>,
        presented: false,
        settled: false,
      });
      const appStateRef = useRewardedAppState(sessionRef, jest.fn());
      return { appStateRef, sessionRef };
    });
    const listener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)?.[1] as (state: AppStateStatus) => void;

    // Act
    act(() => {
      listener('background');
    });

    // Assert: session settled and released without presenting.
    expect(result.current.sessionRef.current).toBeNull();
    expect(result.current.appStateRef.current).toBe('background');
  });

  it('keeps a presented session owned across background transitions', () => {
    // Arrange
    const releaseOwnership = jest.fn();
    const { result } = renderHook(() => {
      const sessionRef = useRef({
        cleanups: [] as Array<() => void>,
        presented: true,
        settled: false,
      });
      const appStateRef = useRewardedAppState(sessionRef, releaseOwnership);
      return { appStateRef, sessionRef };
    });
    const listener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)?.[1] as (state: AppStateStatus) => void;

    // Act
    act(() => {
      listener('inactive');
    });

    // Assert: presented ads stay owned by their CLOSED handler.
    expect(result.current.sessionRef.current).not.toBeNull();
    expect(releaseOwnership).not.toHaveBeenCalled();
  });
});
