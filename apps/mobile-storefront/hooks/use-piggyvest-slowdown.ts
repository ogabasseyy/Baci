import { useEffect, useState } from 'react';
import {
  nextSlowSignalExpiry,
  PIGGYVEST_SLOW_SIGNAL_TTL_MS,
  type PiggyvestSlowSource,
  usePiggyvestSlowdownStore,
} from '@/stores/piggyvest-slowdown-store';

/**
 * Raises (while `slow` is true) or clears this source's PiggyVest slowdown
 * signal. A screen calls it with its own "still slow after retrying" state.
 */
export function useReportPiggyvestSlow(
  source: PiggyvestSlowSource,
  slow: boolean
) {
  const markSlow = usePiggyvestSlowdownStore((state) => state.markSlow);
  const clearSlow = usePiggyvestSlowdownStore((state) => state.clearSlow);
  useEffect(() => {
    if (!slow) {
      clearSlow(source);
      return;
    }
    markSlow(source);
    // Renew while still slow, so a long slowdown never lapses mid-way.
    const timer = setInterval(
      () => markSlow(source),
      PIGGYVEST_SLOW_SIGNAL_TTL_MS / 2
    );
    return () => clearInterval(timer);
  }, [slow, source, markSlow, clearSlow]);
}

/** True while any screen has recently seen PiggyVest answering slowly. */
export function usePiggyvestSlowdown(): boolean {
  const signals = usePiggyvestSlowdownStore((state) => state.signals);
  const [now, setNow] = useState(() => Date.now());
  const expiry = nextSlowSignalExpiry(signals, now);
  // Re-render when the last live signal runs out, so the notice goes away.
  useEffect(() => {
    if (expiry === null) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, expiry - Date.now()) + 1
    );
    return () => clearTimeout(timer);
  }, [expiry]);
  return expiry !== null;
}
