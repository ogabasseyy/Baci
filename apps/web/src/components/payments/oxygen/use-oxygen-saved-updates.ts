'use client';
import { useEffect, useRef } from 'react';

/** Observe durable webhook results only; never submits a provider command. */
export function useOxygenSavedUpdates(
  workflowId: string | undefined,
  waiting: boolean,
  busy: boolean,
  read: () => Promise<void>
) {
  const handlers = useRef({ busy, read });
  useEffect(() => {
    handlers.current = { busy, read };
  }, [busy, read]);
  useEffect(() => {
    if (!workflowId || !waiting) return;
    let cancelled = false;
    let reading = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (
        cancelled ||
        reading ||
        handlers.current.busy ||
        document.visibilityState === 'hidden'
      )
        return false;
      reading = true;
      try {
        await handlers.current.read();
      } catch {
        // A missed saved-state read must not erase confirmed progress.
      } finally {
        reading = false;
      }
      return true;
    };
    const tick = async () => {
      if (await check()) attempts++;
      if (!cancelled && attempts < 20)
        timer = setTimeout(() => void tick(), 15_000);
    };
    const returned = () => {
      void check();
    };
    timer = setTimeout(() => void tick(), 15_000);
    window.addEventListener('focus', returned);
    document.addEventListener('visibilitychange', returned);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('focus', returned);
      document.removeEventListener('visibilitychange', returned);
    };
  }, [workflowId, waiting]);
}
