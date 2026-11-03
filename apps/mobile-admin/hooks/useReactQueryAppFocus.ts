import { focusManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

export function useReactQueryAppFocus(): void {
  useEffect(() => {
    const updateFocus = (state: typeof AppState.currentState) => {
      focusManager.setFocused(state === 'active');
    };

    updateFocus(AppState.currentState);
    const subscription = AppState.addEventListener('change', updateFocus);

    return () => {
      subscription.remove();
    };
  }, []);
}
