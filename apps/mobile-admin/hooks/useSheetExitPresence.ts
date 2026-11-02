import { type RefObject, useEffect, useRef, useState } from 'react';

// Upper bound for an exit animation to report completion. If the callback is
// ever missed, the modal is still released so an invisible layer can never
// keep blocking taps on the screen underneath. Sheets with a longer close
// animation pass their own bound.
export const SHEET_EXIT_FALLBACK_MS = 600;
// iOS reports the native dismissal through the modal's onDismiss; Android has
// no such event, so the release is reported after this delay at the latest.
export const SHEET_DISMISS_REPORT_MS = 350;

/** Reports a released sheet once; later calls do nothing until it presents again. */
function reportRelease(
  dismissPendingRef: RefObject<boolean>,
  releasedRef: RefObject<boolean>,
  onDismissedRef: RefObject<(() => void) | undefined>
) {
  if (!dismissPendingRef.current) return;
  dismissPendingRef.current = false;
  releasedRef.current = false;
  onDismissedRef.current?.();
}

/**
 * Keeps a sheet's modal mounted after `visible` turns false so its exit
 * animation can play, then releases it once the animation finishes. Each
 * release is reported once through `onDismissed`.
 */
export function useSheetExitPresence(
  visible: boolean,
  onDismissed?: () => void,
  exitFallbackMs = SHEET_EXIT_FALLBACK_MS
) {
  const [isPresented, setIsPresented] = useState(visible);
  const visibleRef = useRef(visible);
  const onDismissedRef = useRef(onDismissed);
  // True from presenting until the release is reported.
  const dismissPendingRef = useRef(false);
  // True once the modal was released but its release not yet reported.
  const releasedRef = useRef(false);
  // True when the sheet closed itself (e.g. a pan-down) before `visible`
  // turned false, so there is no exit animation left to wait for.
  const closedBySheetRef = useRef(false);

  // Adjust during render so the modal never commits a hidden frame between
  // `visible` flipping and the exit animation starting.
  if (visible && !isPresented) {
    setIsPresented(true);
  }

  const isExiting = !visible && isPresented;

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    if (visible) closedBySheetRef.current = false;
  }, [visible]);

  useEffect(() => {
    onDismissedRef.current = onDismissed;
  }, [onDismissed]);

  useEffect(() => {
    if (isPresented) {
      // Reopened before the last release was reported: report it now, so
      // what waited on the previous close runs instead of being held until
      // (or bundled with) the next one. This is safe: the previous sheet is
      // already gone, and React Native presents alerts and modals from the
      // top-most screen, so they show above the new sheet. Holding them
      // instead could lose an unconfirmed-booking warning.
      if (releasedRef.current) {
        reportRelease(dismissPendingRef, releasedRef, onDismissedRef);
      }
      dismissPendingRef.current = true;
      return;
    }
    if (!dismissPendingRef.current) return;
    releasedRef.current = true;
    const timer = setTimeout(
      () => reportRelease(dismissPendingRef, releasedRef, onDismissedRef),
      SHEET_DISMISS_REPORT_MS
    );
    return () => clearTimeout(timer);
  }, [isPresented]);

  useEffect(() => {
    if (!isExiting) return;
    if (closedBySheetRef.current) {
      closedBySheetRef.current = false;
      setIsPresented(false);
      return;
    }
    const timer = setTimeout(() => setIsPresented(false), exitFallbackMs);
    return () => clearTimeout(timer);
  }, [isExiting, exitFallbackMs]);

  const finishExit = () => {
    if (!visibleRef.current) {
      setIsPresented(false);
    }
  };

  // The sheet already closed itself; release as soon as `visible` follows.
  const markClosedBySheet = () => {
    closedBySheetRef.current = true;
  };

  // For the modal's onDismiss: the native modal has gone.
  const reportDismissed = () =>
    reportRelease(dismissPendingRef, releasedRef, onDismissedRef);

  return { finishExit, isPresented, markClosedBySheet, reportDismissed };
}
