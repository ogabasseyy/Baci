'use client';
import { useEffect, useRef, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import { oxygenSelfieStatusSchema } from '@/schemas/oxygen-selfie-status';

/** Serial, bounded reads; no messages or iframe events can confirm identity. */
export function useOxygenSelfieStatus(
  workflowId: string | undefined,
  onConfirmed: () => void
) {
  const done = useRef(onConfirmed);
  done.current = onConfirmed;
  const [paused, setPaused] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!workflowId) return;
    let stopped = false;
    let count = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setPaused(false);
    async function check() {
      try {
        const response = await fetchWithCsrf(
          `/api/payments/oxygen/workflows/selfie-status?workflowId=${encodeURIComponent(workflowId ?? '')}`,
          {
            cache: 'no-store',
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(20_000),
            ]),
          }
        );
        if (!response.ok) throw new Error('Status unavailable');
        const status = oxygenSelfieStatusSchema.parse(await response.json());
        if (stopped) return;
        if (status.confirmed) {
          done.current();
          return;
        }
      } catch {
        if (stopped) return;
      }
      if (++count >= 15) {
        setPaused(true);
        return;
      }
      timer = setTimeout(() => void check(), 15_000);
    }
    timer = setTimeout(() => void check(), attempt ? 0 : 15_000);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [workflowId, attempt]);
  return { paused, retry: () => setAttempt((n) => n + 1) };
}
