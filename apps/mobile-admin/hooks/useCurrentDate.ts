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
    // A manual clock or timezone change while foregrounded fires no event:
    // revalidate the day every minute so the anchor cannot sit on a stale
    // month. The updater keeps the previous date when the day is unchanged,
    // so the tick itself renders nothing.
    const sanityTimer = setInterval(() => {
      setNow((previous) => {
        const current = new Date();
        return current.getFullYear() === previous.getFullYear() &&
          current.getMonth() === previous.getMonth() &&
          current.getDate() === previous.getDate()
          ? previous
          : current;
      });
    }, 60 * 1000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });

    return () => {
      clearTimeout(timer);
      clearInterval(sanityTimer);
      subscription.remove();
    };
  }, [now]);

  return now;
}
