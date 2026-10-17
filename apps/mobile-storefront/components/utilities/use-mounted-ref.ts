import { useEffect, useRef } from 'react';

/**
 * Mount-state probe for in-flight purchase guards. Screens wire the
 * returned ref into `getIsActive` so a result settling after
 * back-navigation is preserved for replay instead of shown.
 */
export function useMountedRef() {
  const mountedRef = useRef(true);
  useEffect(() => {
    // Re-arm on setup: Strict Mode replays setup → cleanup → setup,
    // and without this the replayed setup leaves the ref false while
    // the form is still mounted (Codex R37 rktSl).
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}
