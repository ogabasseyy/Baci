import { useEffect, useRef } from 'react';

/**
 * Mount-state probe for in-flight purchase guards. Screens wire the
 * returned ref into `getIsActive` so a result settling after
 * back-navigation is preserved for replay instead of shown.
 */
export function useMountedRef() {
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );
  return mountedRef;
}
