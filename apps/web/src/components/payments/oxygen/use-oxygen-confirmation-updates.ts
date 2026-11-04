'use client';
import { useEffect, useRef } from 'react';

/** Bounded saved-status reads only. Never replays an OTP or booking mutation. */
export function useOxygenConfirmationUpdates(
  workflowId: string | undefined,
  waiting: boolean,
  active: boolean,
  busy: boolean,
  refresh: () => Promise<void>
) {
  const attempts = useRef({ workflowId, count: 0 });
  useEffect(() => {
    if (attempts.current.workflowId !== workflowId)
      attempts.current = { workflowId, count: 0 };
    if (
      !workflowId ||
      !waiting ||
      !active ||
      busy ||
      attempts.current.count >= 4
    )
      return;
    const timer = window.setTimeout(() => {
      attempts.current.count += 1;
      void refresh();
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [workflowId, waiting, active, busy, refresh]);
}
