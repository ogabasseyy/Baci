import { useEffect, useRef } from 'react';

/**
 * Returns a `scheduleTimeout` function whose pending timers are cleared
 * automatically when the component unmounts, so delayed callbacks (e.g.
 * resetting a loading flag after navigation) never fire into an unmounted
 * component. No manual memoization — React Compiler handles it.
 */
export function useSafeTimeout(): (
  callback: () => void,
  delayMs: number
) => void {
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const scheduleTimeout = (callback: () => void, delayMs: number): void => {
    const timers = timersRef.current;
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delayMs);
    timers.add(timer);
  };

  return scheduleTimeout;
}
