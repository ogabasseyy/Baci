'use client';
import { useEffect, useRef } from 'react';

/** A hosted-page return is a reason to read status, never evidence of payment. */
export function useOxygenPaymentReturn(
  open: boolean,
  complete: boolean,
  check: () => void
) {
  const checkRef = useRef(check);
  const wasOpen = useRef(false);
  useEffect(() => {
    checkRef.current = check;
  }, [check]);
  useEffect(() => {
    const returned = wasOpen.current && !open;
    wasOpen.current = open;
    if (returned && !complete) checkRef.current();
  }, [open, complete]);
  useEffect(() => {
    if (!open || complete) return;
    let away = document.visibilityState === 'hidden';
    const visibility = () => {
      if (document.visibilityState === 'hidden') away = true;
      else if (away) {
        away = false;
        checkRef.current();
      }
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) checkRef.current();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pageshow', restored);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pageshow', restored);
    };
  }, [open, complete]);
}
