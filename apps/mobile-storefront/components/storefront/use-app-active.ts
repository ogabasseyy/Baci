import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** Treat an unknown initial state as active until the OS reports otherwise. */
export function useAppActive() {
  const [active, setActive] = useState(
    () =>
      AppState.currentState !== 'background' &&
      AppState.currentState !== 'inactive'
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
    });
    const state = AppState.currentState;
    if (state === 'active' || state === 'background' || state === 'inactive') {
      setActive(state === 'active');
    }
    return () => subscription.remove();
  }, []);
  return active;
}
