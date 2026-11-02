'use client';
import { useEffect, useRef, useState } from 'react';

/** Refresh durable callback results; only three fallback provider reads per watch.
 * Never retries booking, approval, link generation or payment submission. */
export function useOxygenPaymentWatch(
  active: boolean,
  complete: boolean,
  read: () => Promise<void>,
  check: () => Promise<void>
) {
  const handlers = useRef({ read, check });
  const [exhausted, setExhausted] = useState(false);
  useEffect(() => {
    handlers.current = { read, check };
  }, [read, check]);
  useEffect(() => {
    setExhausted(false);
    if (!active || complete) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      attempts++;
      try {
        if (document.visibilityState !== 'hidden') {
          if ([5, 10, 20].includes(attempts)) await handlers.current.check();
          else await handlers.current.read();
        }
      } catch {
        /* Preserve the last confirmed state on transient failure. */
      }
      if (cancelled) return;
      if (attempts >= 20) setExhausted(true);
      else timer = setTimeout(() => void tick(), 3000);
    };
    timer = setTimeout(() => void tick(), 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, complete]);
  return exhausted;
}
