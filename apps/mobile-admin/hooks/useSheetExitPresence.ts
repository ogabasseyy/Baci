import { useEffect, useRef, useState } from 'react';

// Upper bound for an exit animation to report completion. If the callback is
// ever missed, the modal is still released so an invisible layer can never
// keep blocking taps on the screen underneath.
export const SHEET_EXIT_FALLBACK_MS = 600;
// iOS reports the native dismissal through the modal's onDismiss; Android has
// no such event, so the release is reported after this delay at the latest.
export const SHEET_DISMISS_REPORT_MS = 350;

/**
 * Keeps a sheet's modal mounted after `visible` turns false so its exit
 * animation can play, then releases it once the animation finishes. Each
 * release is reported once through `onDismissed`.
 */
export function useSheetExitPresence(
  visible: boolean,
  onDismissed?: () => void
) {
  const [isPresented, setIsPresented] = useState(visible);
  const visibleRef = useRef(visible);
  const onDismissedRef = useRef(onDismissed);
  const dismissPendingRef = useRef(false);

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
    onDismissedRef.current = onDismissed;
  }, [onDismissed]);

  useEffect(() => {
    if (isPresented) {
      dismissPendingRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      if (!dismissPendingRef.current) return;
      dismissPendingRef.current = false;
      onDismissedRef.current?.();
    }, SHEET_DISMISS_REPORT_MS);
    return () => clearTimeout(timer);
  }, [isPresented]);

  // For the modal's onDismiss: the native modal has gone.
  const reportDismissed = () => {
    if (!dismissPendingRef.current) return;
    dismissPendingRef.current = false;
    onDismissedRef.current?.();
  };

  useEffect(() => {
    if (!isExiting) return;
    const timer = setTimeout(
      () => setIsPresented(false),
      SHEET_EXIT_FALLBACK_MS
    );
    return () => clearTimeout(timer);
  }, [isExiting]);

  const finishExit = () => {
    if (!visibleRef.current) {
      setIsPresented(false);
    }
  };

  return { finishExit, isPresented, reportDismissed };
}
