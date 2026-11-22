import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import { useEffect, useRef, useState } from 'react';
import type { OxygenWorkflowController } from '@/services/oxygen/workflow';
import { oxygenPrebookingStep } from './oxygen-checkout-presentation';

/** Initial check plus bounded follow-ups of explicit provider-pending results only. */
export function useOxygenEligibilityProgress(
  snapshot: OxygenRuntimeSnapshot,
  controller: OxygenWorkflowController,
  blocked: boolean
) {
  const attempts = useRef(new Map<string, number>());
  const [delayedWorkflow, setDelayedWorkflow] = useState<string | null>(null);
  useEffect(() => {
    if (
      blocked ||
      !snapshot.executionEnabled ||
      snapshot.pending ||
      snapshot.state.bookingReference ||
      snapshot.state.eligible !== undefined ||
      snapshot.state.eligibilityStatus === 'failed' ||
      oxygenPrebookingStep(snapshot) !== 'eligibility' ||
      controller.getState().error
    )
      return;
    const count = attempts.current.get(snapshot.workflowId) ?? 0;
    // A saved pending result is already known. Let the customer choose when
    // to check it again instead of retrying each time the screen is reopened.
    if (count === 0 && snapshot.state.eligibilityStatus === 'pending') {
      setDelayedWorkflow(snapshot.workflowId);
      return;
    }
    if (count >= 3) {
      setDelayedWorkflow(snapshot.workflowId);
      return;
    }
    if (count > 0 && snapshot.state.eligibilityStatus !== 'pending') return;
    const check = () => {
      attempts.current.set(snapshot.workflowId, count + 1);
      void controller.execute({ action: 'refresh_eligibility' }).then(() => {
        const result = controller.getState();
        if (
          count === 0 &&
          result.error &&
          result.snapshot?.state.eligibilityStatus !== 'pending'
        )
          attempts.current.delete(snapshot.workflowId);
      });
    };
    if (count === 0) {
      check();
      return;
    }
    const timer = setTimeout(check, 20000);
    return () => clearTimeout(timer);
  }, [snapshot, controller, blocked]);
  return { delayed: delayedWorkflow === snapshot.workflowId };
}
