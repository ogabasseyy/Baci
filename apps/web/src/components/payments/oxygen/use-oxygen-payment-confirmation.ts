'use client';
import { useEffect, useRef } from 'react';

/** Read saved workflow state only; never sends a payment or activation command. */
export function useOxygenPaymentConfirmation(
  enabled: boolean,
  busy: boolean,
  read: (() => Promise<void>) | undefined
) {
  const handlers = useRef({ busy, read });
  useEffect(() => {
    handlers.current = { busy, read };
  }, [busy, read]);
  useEffect(() => {
    if (!enabled || !handlers.current.read) return;
    let cancelled = false;
    let inFlight = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      if (
        cancelled ||
        inFlight ||
        attempts >= 20 ||
        handlers.current.busy ||
        document.visibilityState === 'hidden'
      )
        return;
      const readSaved = handlers.current.read;
      if (!readSaved) return;
      inFlight = true;
      attempts++;
      try {
        await readSaved();
      } catch {
        // Keep the confirmed payment visible if a status read fails.
      } finally {
        inFlight = false;
      }
    };
    const tick = async () => {
      await check();
      if (!cancelled && attempts < 20)
        timer = setTimeout(() => void tick(), 15_000);
    };
    const returned = () => void check();
    void tick();
    window.addEventListener('focus', returned);
    document.addEventListener('visibilitychange', returned);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', returned);
      document.removeEventListener('visibilitychange', returned);
    };
  }, [enabled]);
}
