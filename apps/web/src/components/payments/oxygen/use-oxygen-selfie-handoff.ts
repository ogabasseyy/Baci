'use client';
import { useContext, useEffect, useRef } from 'react';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import {
  OxygenSelfieConfirmedContext,
  OxygenSelfieSurfaceContext,
} from './OxygenPaymentSurfaceContext';
import type { SubmitOxygenForm } from './OxygenVerificationForms';

export function useOxygenSelfieHandoff(
  snapshot: OxygenRuntimeSnapshot | null,
  active: boolean,
  busy: boolean,
  submit: SubmitOxygenForm,
  refresh: () => Promise<unknown>
) {
  const open = useContext(OxygenSelfieSurfaceContext);
  const confirmed = useContext(OxygenSelfieConfirmedContext);
  const opened = useRef('');
  const synced = useRef('');
  useEffect(() => {
    if (!snapshot || !active || busy) return;
    const { state, workflowId } = snapshot;
    if (confirmed === workflowId) {
      if (synced.current === workflowId) return;
      synced.current = workflowId;
      // Preserve the existing uncertain command; status confirmation is not reconciliation.
      if (snapshot.pending || snapshot.stage === 'reconciliation_required')
        void refresh();
      else void submit({ action: 'refresh_kyc' });
      return;
    }
    const url = state.selfieUrl;
    if (
      !snapshot.executionEnabled ||
      !state.validated ||
      !url ||
      state.bookingReference ||
      state.kyc?.selfie_status === 'DONE' ||
      opened.current === url ||
      !open
    )
      return;
    if (snapshot.pending && snapshot.pending.action !== 'validate_nin') return;
    opened.current = url;
    open(url, workflowId);
  }, [snapshot, active, busy, open, confirmed, submit, refresh]);
  return Boolean(snapshot && confirmed === snapshot.workflowId);
}
