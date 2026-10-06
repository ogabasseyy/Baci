import type { RefObject } from 'react';
import { useEffect } from 'react';
import type { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Distance from the safe-area top inset down to where the just-selected card
 * should rest: the fixed Checkout header + Delivery/Payment/Review stepper
 * (~172) plus a little breathing room so the card sits clearly below the
 * stepper instead of flush against it. `insets.top + this` is the target window
 * Y for the card's top. Tunable; a few px either way is harmless.
 */
export const STEPPER_STACK_HEIGHT = 205;

interface UseIntentScrollIntoViewParams {
  /** Changes whenever the selected/expanded intent changes. */
  expandedKey: string;
  cardRef: RefObject<View | null>;
  scrollRef?: RefObject<ScrollView | null>;
  scrollOffsetRef?: RefObject<number>;
}

/**
 * Keeps the just-selected intent card visible after a selection. Selecting an
 * intent collapses the previously-expanded card, removing its instrument rows
 * and shifting everything below it (including the card the user just tapped)
 * upward — often off the top of the screen. After the layout commit we measure
 * the selected card and, if it was pushed above the viewport top, scroll it back
 * into view. No-ops without a scroll ref, so tests and non-checkout callers that
 * omit the refs are unaffected. State is never touched — this is a pure,
 * post-commit scroll correction.
 */
export function useIntentScrollIntoView({
  expandedKey,
  cardRef,
  scrollRef,
  scrollOffsetRef,
}: UseIntentScrollIntoViewParams) {
  const insets = useSafeAreaInsets();

  // biome-ignore lint/correctness/useExhaustiveDependencies: expandedKey is intentionally unread — it retriggers the post-collapse scroll correction when the expanded card changes.
  useEffect(() => {
    if (!scrollRef?.current || !cardRef.current) return;
    // The window Y just under the stepper — where the card should sit.
    const viewportTop = insets.top + STEPPER_STACK_HEIGHT;
    // rAF lets native flush the collapse+expand layout pass before we measure,
    // so measureInWindow reports the card's final (post-collapse) position.
    const frame = requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      const card = cardRef.current;
      if (!scroller || !card) return;
      card.measureInWindow((_x, cardTop) => {
        if (cardTop >= viewportTop) return; // still below the stepper — in view
        const currentOffset = scrollOffsetRef?.current ?? 0;
        const nextY = Math.max(currentOffset - (viewportTop - cardTop), 0);
        scroller.scrollTo({ y: nextY, animated: true });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [expandedKey, cardRef, scrollRef, scrollOffsetRef, insets.top]);
}
