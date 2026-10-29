'use client';
import { useEffect, useRef, useState } from 'react';
/** A short presentation pause after confirmed success, never a verification timer. */
export function useOtpSuccessTransition() {
  const [verified, setVerified] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const done = useRef<(() => void) | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      done.current?.();
    },
    []
  );
  async function showSuccess() {
    setVerified(true);
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    await new Promise<void>((resolve) => {
      done.current = resolve;
      timer.current = setTimeout(() => {
        done.current = undefined;
        resolve();
      }, 800);
    });
  }
  return { verified, showSuccess };
}
