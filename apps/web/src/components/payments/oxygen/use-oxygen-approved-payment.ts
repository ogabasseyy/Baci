'use client';
import { useState } from 'react';
import type { OxygenRuntimeAction } from '@/schemas/oxygen-runtime';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';

export function useOxygenApprovedPayment(
  snapshot: OxygenRuntimeSnapshot | null,
  disabled: boolean,
  submit: (
    command: OxygenRuntimeAction,
    file?: File,
    confirmed?: () => Promise<void>
  ) => Promise<boolean>
) {
  const [autoOpenReference, setAutoOpenReference] = useState<string>();
  function available(reference: string) {
    return (
      reference === snapshot?.state.bookingReference &&
      snapshot.executionEnabled &&
      !disabled &&
      snapshot.stage === 'approval_required'
    );
  }
  async function approvePlan(
    reference: string,
    otp: string,
    signature: File,
    onConfirmed?: () => Promise<void>
  ) {
    if (!available(reference)) return false;
    return await submit(
      { action: 'approve_booking', otp, accepted: true },
      signature,
      async () => {
        await onConfirmed?.();
        setAutoOpenReference(reference);
      }
    );
  }
  async function requestApprovalCode(reference: string) {
    if (!available(reference)) return false;
    return await submit({ action: 'trigger_approval_otp' });
  }
  return { autoOpenReference, approvePlan, requestApprovalCode };
}
