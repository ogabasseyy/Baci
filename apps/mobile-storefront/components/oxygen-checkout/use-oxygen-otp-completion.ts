import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import { useEffect, useRef, useState } from 'react';

type Completion = { workflowId: string; kind: 'phone' | 'approval' };
/** A short presentation pause after confirmed progress, never a provider retry. */
export function useOxygenOtpCompletion(snapshot: OxygenRuntimeSnapshot | null) {
  const previous = useRef(snapshot);
  const [held, setHeld] = useState<Completion | null>(null);
  const before = previous.current;
  const transition: Completion | null =
    before && snapshot && before.workflowId === snapshot.workflowId
      ? before.state?.applicationReference &&
        !before.state.validated &&
        snapshot.state.validated
        ? { workflowId: snapshot.workflowId, kind: 'phone' }
        : before.stage === 'approval_required' &&
            snapshot.stage === 'payment_required'
          ? { workflowId: snapshot.workflowId, kind: 'approval' }
          : null
      : null;
  useEffect(() => {
    previous.current = snapshot;
    if (transition) setHeld(transition);
  }, [snapshot, transition]);
  useEffect(() => {
    if (!held) return;
    const timer = setTimeout(
      () => setHeld((current) => (current === held ? null : current)),
      850
    );
    return () => clearTimeout(timer);
  }, [held]);
  const visible = held?.workflowId === snapshot?.workflowId ? held : transition;
  return visible;
}
