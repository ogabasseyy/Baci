'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const subscribeToHydration = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Custom hook for state that persists to sessionStorage.
 * 2025 best practices:
 * - Restore storage values after the server hydration snapshot
 * - Debounced writes to avoid performance issues
 * - Proper cleanup and error handling
 * - Type-safe with generics
 */
export function usePersistedState<T>(
  key: string,
  initialValue: T,
  options: {
    /** Debounce delay in ms (default: 300) */
    debounceMs?: number;
    /** Storage type (default: sessionStorage) */
    storage?: 'session' | 'local';
  } = {}
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const { debounceMs = 300, storage = 'session' } = options;
  const isHydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientSnapshot,
    getServerSnapshot
  );

  // Use lazy initialization to read from storage only once
  const [state, setState] = useState<T>(() => {
    // Always return initialValue on server (SSR safety)
    if (typeof window === 'undefined') return initialValue;

    try {
      const storageApi = storage === 'local' ? localStorage : sessionStorage;
      const stored = storageApi.getItem(key);
      if (stored) {
        return JSON.parse(stored) as T;
      }
    } catch {
      // Storage access failed, use initial value
    }
    return initialValue;
  });

  // Ref to track the debounce timer
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Payment redirects can leave before the debounce timer fires.
  const flushRef = useRef<(() => void) | null>(null);
  const clearedRef = useRef(false);
  // Keep the latest intended value outside React's render schedule so pagehide
  // cannot flush a stale closure over a newer snapshot (e.g. pending order).
  const latestValueRef = useRef(state);

  const writeValue = (value: T) => {
    try {
      const storageApi = storage === 'local' ? localStorage : sessionStorage;
      storageApi.setItem(key, JSON.stringify(value));
    } catch {
      // Storage write failed (quota exceeded, private browsing, etc.)
    }
  };

  const armFlush = () => {
    flushRef.current = () => {
      if (clearedRef.current) return;
      writeValue(latestValueRef.current);
    };
  };

  // Persist to storage with debouncing
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (clearedRef.current) return;

    latestValueRef.current = state;

    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    const persist = () => {
      if (clearedRef.current) return;
      writeValue(latestValueRef.current);
    };
    flushRef.current = persist;
    timerRef.current = setTimeout(persist, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [state, debounceMs, writeValue]);

  // Cleanup on unmount
  useEffect(() => {
    const flush = () => flushRef.current?.();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  // Clear function to remove from storage
  const clear = () => {
    if (typeof window === 'undefined') return;
    if (timerRef.current) clearTimeout(timerRef.current);
    flushRef.current = null;
    clearedRef.current = true;
    latestValueRef.current = initialValue;
    try {
      const storageApi = storage === 'local' ? localStorage : sessionStorage;
      storageApi.removeItem(key);
    } catch {
      // Ignore errors
    }
    setState(initialValue);
  };

  const updateState: React.Dispatch<React.SetStateAction<T>> = (update) => {
    clearedRef.current = false;
    const previous = latestValueRef.current;
    const next =
      typeof update === 'function'
        ? (update as (value: T) => T)(previous)
        : update;
    latestValueRef.current = next;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    armFlush();
    setState(next);
  };

  return [isHydrated ? state : initialValue, updateState, clear];
}

/**
 * Hook for persisting multiple related form fields as a single object.
 * More efficient than multiple usePersistedState calls.
 */
export function usePersistedForm<T extends Record<string, unknown>>(
  key: string,
  initialValues: T,
  options: {
    debounceMs?: number;
    storage?: 'session' | 'local';
  } = {}
): {
  values: T;
  setValue: <K extends keyof T>(field: K, value: T[K]) => void;
  setValues: (updates: Partial<T>) => void;
  reset: () => void;
  clear: () => void;
} {
  const [values, setValuesState, clear] = usePersistedState<T>(
    key,
    initialValues,
    options
  );

  const setValue = <K extends keyof T>(field: K, value: T[K]) => {
    setValuesState((prev) => ({ ...prev, [field]: value }));
  };

  const setValues = (updates: Partial<T>) => {
    setValuesState((prev) => ({ ...prev, ...updates }));
  };

  const reset = () => {
    setValuesState(initialValues);
  };

  return { values, setValue, setValues, reset, clear };
}
