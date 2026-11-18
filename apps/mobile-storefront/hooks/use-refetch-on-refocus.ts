import { useFocusEffect } from 'expo-router';
import { useEffect, useRef } from 'react';

/**
 * Re-reads a screen's data once each time the screen regains focus (Fable
 * walk 10): money moved outside the app shows on re-entry without a
 * pull-to-refresh. The first focus is the mount, whose query already loads,
 * so it is skipped.
 */
export function useRefetchOnRefocus(refetch: () => unknown): void {
  const focusedBefore = useRef(false);
  // The latest refetch lives in a ref and the focus effect is created once:
  // useFocusEffect re-runs its effect whenever the callback changes while the
  // screen stays focused, so a new callback per render (one capturing fetch
  // state, say) would otherwise start a refetch after every fetch.
  const latest = useRef(refetch);
  useEffect(() => {
    latest.current = refetch;
  });
  const onFocus = useRef(() => {
    if (!focusedBefore.current) {
      focusedBefore.current = true;
      return;
    }
    void latest.current();
  }).current;
  useFocusEffect(onFocus);
}
