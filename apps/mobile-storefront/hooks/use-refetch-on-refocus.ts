import { useFocusEffect } from 'expo-router';
import { useRef } from 'react';

/**
 * Re-reads a screen's data once each time the screen regains focus (Fable
 * walk 10): money moved outside the app shows on re-entry without a
 * pull-to-refresh. The first focus is the mount, whose query already loads,
 * so it is skipped.
 */
export function useRefetchOnRefocus(refetch: () => unknown): void {
  const focusedBefore = useRef(false);
  useFocusEffect(() => {
    if (!focusedBefore.current) {
      focusedBefore.current = true;
      return;
    }
    void refetch();
  });
}
