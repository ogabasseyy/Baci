import { useEffect } from 'react';
import { type SharedValue, withTiming } from 'react-native-reanimated';
import { useAppActive } from './use-app-active';

export function useUtilityAutoplay({
  activeIndex,
  autoplayPaused,
  isFocused,
  isManual,
  itemCount,
}: {
  activeIndex: SharedValue<number>;
  autoplayPaused: boolean;
  isFocused: boolean;
  isManual: boolean;
  itemCount: number;
}) {
  const appActive = useAppActive();
  useEffect(() => {
    if (isManual || !isFocused || !appActive || autoplayPaused) return;
    const interval = setInterval(() => {
      const next = (Math.round(activeIndex.get()) + 1) % itemCount;
      activeIndex.set(next === 0 ? 0 : withTiming(next, { duration: 300 }));
    }, 2800);
    return () => clearInterval(interval);
  }, [activeIndex, appActive, autoplayPaused, isFocused, isManual, itemCount]);
}
