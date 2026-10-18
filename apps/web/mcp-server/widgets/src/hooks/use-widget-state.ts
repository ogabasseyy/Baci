import { type SetStateAction, useLayoutEffect, useRef, useState } from 'react';
import { widgetHost } from '../widget-host';
import { useOpenAiGlobal } from './use-openai-global';

type UnknownObject = Record<string, unknown>;

/**
 * Hook to manage widget state that persists across conversation turns
 * Automatically syncs with getWidgetHost()?.widgetState
 */
export function useWidgetState<T extends UnknownObject>(
  defaultState: T | (() => T)
): readonly [T, (state: SetStateAction<T>) => void];
export function useWidgetState<T extends UnknownObject>(
  defaultState?: T | (() => T | null) | null
): readonly [T | null, (state: SetStateAction<T | null>) => void];
export function useWidgetState<T extends UnknownObject>(
  defaultState?: T | (() => T | null) | null
): readonly [T | null, (state: SetStateAction<T | null>) => void] {
  const widgetStateFromWindow = useOpenAiGlobal('widgetState') as T;

  const [widgetState, _setWidgetState] = useState<T | null>(() => {
    if (widgetStateFromWindow != null) {
      return widgetStateFromWindow;
    }

    return typeof defaultState === 'function'
      ? defaultState()
      : (defaultState ?? null);
  });
  const [prevWidgetStateFromWindow, setPrevWidgetStateFromWindow] =
    useState<T | null>(widgetStateFromWindow);

  // Sync from getWidgetHost()?.widgetState when it changes (e.g., from tool
  // responses). Adjusting state inline during render avoids the extra render
  // (and stale frame) an effect would introduce, and lets the React Compiler
  // memoize this hook.
  if (widgetStateFromWindow !== prevWidgetStateFromWindow) {
    setPrevWidgetStateFromWindow(widgetStateFromWindow);
    if (widgetStateFromWindow != null) {
      _setWidgetState(widgetStateFromWindow);
    }
  }

  const latestState = useRef(widgetState);
  useLayoutEffect(() => {
    latestState.current = widgetState;
  }, [widgetState]);

  const setWidgetState = (state: SetStateAction<T | null>) => {
    const newState =
      typeof state === 'function' ? state(latestState.current) : state;
    latestState.current = newState;
    _setWidgetState(newState);

    // Persist outside React's updater, which React may replay.
    if (newState != null && typeof window !== 'undefined') {
      void widgetHost.get()?.setWidgetState?.(newState);
    }
  };

  return [widgetState, setWidgetState] as const;
}
