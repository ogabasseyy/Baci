import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import { useEffect, useRef, useState } from 'react';
import type { OxygenWorkflowController } from '@/services/oxygen/workflow';

/** First attempts only. Server admission and the intent journal fence every dispatch. */
export function useOxygenInitialNin(
  snapshot: OxygenRuntimeSnapshot,
  controller: OxygenWorkflowController,
  blocked: boolean
) {
  const attempted = useRef(new Set<string>());
  const alive = useRef(true);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const s = snapshot.state;
    if (
      blocked ||
      !snapshot.executionEnabled ||
      snapshot.pending ||
      s.bookingReference ||
      !s.validated ||
      s.eligible !== true ||
      snapshot.ninAttemptStatus !== 'first_attempt' ||
      !['kyc_required', 'eligibility_required'].includes(snapshot.stage) ||
      s.kyc?.nin_status !== 'NOT_DONE' ||
      !['phone_status', 'bvn_status', 'selfie_status'].every(
        (k) =>
          s.kyc?.[k as 'phone_status' | 'bvn_status' | 'selfie_status'] ===
          'DONE'
      ) ||
      controller.getState().error ||
      attempted.current.has(snapshot.workflowId)
    )
      return;
    attempted.current.add(snapshot.workflowId);
    setRunning(true);
    void (async () => {
      await controller.execute({ action: 'validate_nin' });
      const state = controller.getState();
      if (
        alive.current &&
        !state.error &&
        !state.snapshot?.pending &&
        state.snapshot?.workflowId === snapshot.workflowId &&
        state.snapshot.state.kyc?.nin_status !== 'DONE'
      ) {
        await controller.execute({ action: 'refresh_kyc' });
      }
    })().finally(() => {
      if (alive.current) setRunning(false);
    });
  }, [snapshot, controller, blocked]);
  return running;
}
