import { useCallback, useEffect, useState } from 'react';

const CLOCK_TICK_MS = 15_000;

/**
 * Rerender on a clock tick so time-derived validity follows the wall
 * clock while the page sits open. Render-time checks (schedule starts,
 * expiries) go stale without interaction; the tick rerenders anyway so
 * buttons disable and alerts appear on their own. Returns a manual
 * retick for submit paths that detect expiry between ticks.
 */
export function useQuizAuthoringClock(): () => void {
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setClockTick((tick) => tick + 1),
      CLOCK_TICK_MS
    );
    return () => clearInterval(timer);
  }, []);
  return useCallback(() => setClockTick((tick) => tick + 1), []);
}
