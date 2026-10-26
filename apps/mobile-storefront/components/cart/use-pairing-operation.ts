import { useLayoutEffect, useRef, useState } from 'react';

/** Keep pairing resolution reachable until the awaited operation has settled. */
export function usePairingOperation(onDismiss: () => void) {
  const active = useRef(false);
  const mounted = useRef(true);
  const [running, setRunning] = useState(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return {
    running,
    dismiss: () => {
      if (!active.current) onDismiss();
    },
    run: async (operation: () => Promise<void>) => {
      if (active.current) return;
      active.current = true;
      setRunning(true);
      try {
        await operation();
      } finally {
        active.current = false;
        if (mounted.current) setRunning(false);
      }
    },
  };
}
