import { type RefObject, useEffect } from 'react';

/** Read by the Chatwoot SDK launcher (phones only, where chat opens full screen). */
export const CHATWOOT_BUBBLE_CLEARANCE_PROPERTY =
  '--cw-bubble-bottom-clearance';

// The SDK already keeps the launcher this far above the screen bottom.
const SDK_BOTTOM_GAP_PX = 20;
// Air between the launcher and the bar it clears.
const BAR_GAP_PX = 8;

/**
 * Lifts the Chatwoot launcher above a fixed bottom bar while that bar shows.
 *
 * The clearance is measured from the bar's real top edge, so it follows the
 * bar's height and offset instead of copying a number, and it disappears with
 * the bar (empty cart, desktop layout where the bar is hidden).
 *
 * Contract with the Chatwoot SDK launcher (sdk.css and bubbleDrag.js in the
 * Baci Chatwoot fork): at max-width 667px the launcher sits at
 * `bottom: calc(20px + var(--cw-bubble-bottom-clearance, 0px))`, and its drag
 * limit keeps the same distance. So the variable is EXTRA clearance on top of
 * the SDK's own 20px, which is why that 20px is subtracted below. Without the
 * patched SDK build the variable is unused.
 */
export function useChatwootLauncherClearance(
  barRef: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    let frame = 0;

    const publish = () => {
      const rect = bar.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        root.style.removeProperty(CHATWOOT_BUBBLE_CLEARANCE_PROPERTY);
        return;
      }
      const lift =
        window.innerHeight - rect.top + BAR_GAP_PX - SDK_BOTTOM_GAP_PX;
      root.style.setProperty(
        CHATWOOT_BUBBLE_CLEARANCE_PROPERTY,
        `${Math.max(0, Math.round(lift))}px`
      );
    };
    const schedulePublish = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        publish();
      });
    };

    publish();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(schedulePublish);
    observer?.observe(bar);
    window.addEventListener('resize', schedulePublish);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedulePublish);
      root.style.removeProperty(CHATWOOT_BUBBLE_CLEARANCE_PROPERTY);
    };
  }, [barRef]);
}
