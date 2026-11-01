'use client';
import { useEffect, useRef, useState } from 'react';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import type { SubmitOxygenForm } from './OxygenVerificationForms';
import type { ResidentialProof } from './oxygen-residential-address';

/** Proof stays in memory, scoped to this workflow. Never localStorage or general draft JSON. */
export function useOxygenResidentialSubmission(
  snapshot: OxygenRuntimeSnapshot | null,
  active: boolean,
  busy: boolean,
  error: string,
  submit: SubmitOxygenForm
) {
  const [prepared, setPrepared] = useState<{
    workflowId: string;
    proof: ResidentialProof;
  } | null>(null);
  const attempted = useRef(new Set<string>());
  const [sending, setSending] = useState(false);
  const proof =
    prepared?.workflowId === snapshot?.workflowId ? prepared?.proof : undefined;
  const reference = snapshot?.state.bookingReference;
  const eligible = Boolean(
    active &&
      snapshot?.executionEnabled &&
      snapshot.stage === 'booked' &&
      !snapshot.pending &&
      !busy &&
      !error &&
      reference &&
      proof &&
      snapshot.state.kyc?.address_status === 'NOT_DONE'
  );
  const waiting =
    sending ||
    Boolean(eligible && reference && !attempted.current.has(reference));
  useEffect(() => {
    if (!eligible || !reference || !proof || attempted.current.has(reference))
      return;
    attempted.current.add(reference); // Mark before dispatch, including rejected/indeterminate responses.
    setSending(true);
    void submit({ action: 'submit_address', ...proof.address }, proof.file)
      .catch(() => false)
      .finally(() => setSending(false));
  }, [eligible, reference, proof, submit]);
  return {
    waiting,
    proof,
    prepare: (workflowId: string, proof: ResidentialProof) =>
      setPrepared({ workflowId, proof }),
  };
}
