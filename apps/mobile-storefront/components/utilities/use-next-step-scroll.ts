import { type RefObject, useEffect, useRef } from 'react';
import type { ScrollViewInstance } from 'react-native';
import { SPACING } from '@/constants/Colors';

/**
 * Schedules a next-step scroll when the JS thread becomes idle.
 *
 * Calls made while a scroll is already scheduled use last-write-wins semantics:
 * the pending scroll target is overwritten, but only one animation frame and
 * idle callback are queued.
 */
export function useNextStepScroll(
  scrollViewRef: RefObject<ScrollViewInstance | null>,
  onScrollInitiated: () => void
) {
  const pendingScrollYRef = useRef<number | null>(null);
  const isScrollScheduledRef = useRef(false);
  const isMountedRef = useRef(true);
  const onScrollInitiatedRef = useRef(onScrollInitiated);
  const scrollFrameRef = useRef<number | null>(null);
  const idleHandleRef = useRef<number | null>(null);

  useEffect(() => {
    onScrollInitiatedRef.current = onScrollInitiated;
  }, [onScrollInitiated]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
      if (idleHandleRef.current !== null)
        cancelIdleCallback(idleHandleRef.current);
      idleHandleRef.current = null;
      pendingScrollYRef.current = null;
      isScrollScheduledRef.current = false;
    };
  }, []);

  return (nextStepY: number) => {
    pendingScrollYRef.current = Math.max(nextStepY - SPACING.md, 0);
    if (isScrollScheduledRef.current) {
      return;
    }
    isScrollScheduledRef.current = true;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      idleHandleRef.current = requestIdleCallback(() => {
        idleHandleRef.current = null;
        const scrollY = pendingScrollYRef.current;
        pendingScrollYRef.current = null;
        isScrollScheduledRef.current = false;
        const scrollView = scrollViewRef.current;
        if (!isMountedRef.current || scrollY === null || !scrollView) {
          return;
        }
        scrollView.scrollTo({ animated: true, y: scrollY });
        onScrollInitiatedRef.current();
      });
    });
  };
}
