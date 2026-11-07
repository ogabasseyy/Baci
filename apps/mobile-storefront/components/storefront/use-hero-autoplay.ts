import { useIsFocused } from 'expo-router';
import { type RefObject, useEffect } from 'react';
import { useAppActive } from './use-app-active';

interface HeroAutoplayOptions {
  autoplayDelay: number;
  autoplayPaused: boolean;
  currentIndex: number;
  itemCount: number;
  listRef: RefObject<{
    scrollToIndex: (options: { index: number; animated: boolean }) => void;
  } | null>;
}

/** Pause automatic movement while the carousel is obscured or backgrounded. */
export function useHeroAutoplay({
  autoplayDelay,
  autoplayPaused,
  currentIndex,
  itemCount,
  listRef,
}: HeroAutoplayOptions) {
  const focused = useIsFocused();
  const appActive = useAppActive();

  useEffect(() => {
    if (autoplayPaused || !focused || !appActive || itemCount <= 1) return;
    const interval = setInterval(() => {
      listRef.current?.scrollToIndex({
        index: (currentIndex + 1) % itemCount,
        animated: true,
      });
    }, autoplayDelay);
    return () => clearInterval(interval);
  }, [
    appActive,
    autoplayDelay,
    autoplayPaused,
    currentIndex,
    focused,
    itemCount,
    listRef,
  ]);
}
