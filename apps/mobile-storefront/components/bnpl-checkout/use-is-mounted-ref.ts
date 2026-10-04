import type { MutableRefObject } from 'react';
import { useEffect, useRef } from 'react';

/**
 * Lifetime guard for async continuations (success attribution, completion
 * tracking) that can resolve after the screen is gone: a late resolution
 * must not clear the cart or navigate after unmount.
 */
export function useIsMountedRef(): MutableRefObject<boolean> {
  const isMountedRef = useRef(true);
  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    []
  );
  return isMountedRef;
}
