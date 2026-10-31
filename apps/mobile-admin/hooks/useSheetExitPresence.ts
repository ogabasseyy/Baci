import { useEffect, useRef, useState } from 'react';

// Upper bound for an exit animation to report completion. If the callback is
// ever missed, the modal is still released so an invisible layer can never
// keep blocking taps on the screen underneath.
export const SHEET_EXIT_FALLBACK_MS = 600;

/**
 * Keeps a sheet's modal mounted after `visible` turns false so its exit
 * animation can play, then releases it once the animation finishes.
 */
export function useSheetExitPresence(visible: boolean) {
  const [isPresented, setIsPresented] = useState(visible);
  const visibleRef = useRef(visible);

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

  return { finishExit, isPresented };
}
