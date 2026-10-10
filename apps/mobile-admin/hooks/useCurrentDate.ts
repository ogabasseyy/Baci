import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

// Keep calendar-based summaries current across midnight and app suspension.
export function useCurrentDate() {
  const [now, setNow] = useState(() => new Date());
  // A Date's offset is computed from the live system timezone, so comparing
  // two Dates can never reveal a timezone jump: capture the offset in state.
  const [offset, setOffset] = useState(() => new Date().getTimezoneOffset());

  useEffect(() => {
    const refresh = () => {
      setNow(new Date());
      setOffset(new Date().getTimezoneOffset());
    };
    const nextDay = new Date(now);
    nextDay.setHours(24, 0, 0, 0);
    const timer = setTimeout(
      refresh,
      Math.max(1, nextDay.getTime() - Date.now())
    );
    // A manual clock or timezone change while foregrounded fires no event:
    // revalidate the day and offset every minute so the anchor cannot sit on
    // stale month boundaries. Neither setter runs when nothing changed, so
    // the tick itself renders nothing.
    const sanityTimer = setInterval(() => {
      const current = new Date();
      const dayChanged =
        current.getFullYear() !== now.getFullYear() ||
        current.getMonth() !== now.getMonth() ||
        current.getDate() !== now.getDate();
      if (dayChanged || current.getTimezoneOffset() !== offset) {
        setNow(current);
        setOffset(current.getTimezoneOffset());
      }
    }, 60 * 1000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });

    return () => {
      clearTimeout(timer);
      clearInterval(sanityTimer);
      subscription.remove();
    };
  }, [now, offset]);

  return now;
}
