import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

// Keep calendar-based summaries current across midnight and app suspension.
export function useCurrentDate() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => setNow(new Date());
    const nextDay = new Date(now);
    nextDay.setHours(24, 0, 0, 0);
    const timer = setTimeout(
      refresh,
      Math.max(1, nextDay.getTime() - Date.now())
    );
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });

    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [now]);

  return now;
}
