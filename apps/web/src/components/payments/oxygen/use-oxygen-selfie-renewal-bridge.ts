'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { oxygenSelfieStatusSchema } from '@/schemas/oxygen-selfie-status';
import type { SubmitOxygenForm } from './OxygenVerificationForms';
import { selfieLinkExpired } from './selfie-link-expired';

export type OxygenSelfieRenewHandler = (
  url: string,
  workflowId: string | undefined,
  automatic: boolean,
  signal?: AbortSignal
) => Promise<'confirmed' | 'renewed'>;

/** Reuses the ownership-checked, journaled submit path even while its UI is hidden. */
export function useOxygenSelfieRenewalBridge(
  snapshot: OxygenRuntimeSnapshot | null,
  busy: boolean,
  submit: SubmitOxygenForm,
  open: ((url: string, workflowId?: string) => void) | null,
  hostedOpen = false
): OxygenSelfieRenewHandler {
  const latest = useRef({ snapshot, busy, submit, open });
  useLayoutEffect(() => {
    latest.current = { snapshot, busy, submit, open };
  });
  const attempts = useRef(
    new Map<string, { total: number; automatic: boolean }>()
  );
  const locked = useRef(false);
  const alive = useRef(true);
  const pending = useRef<{
    url: string;
    workflowId: string;
    signal?: AbortSignal;
  } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current = null;
    };
  }, []);
  useEffect(() => {
    const request = pending.current;
    if (!request || busy) return;
    if (
      (request.signal?.aborted && !hostedOpen) ||
      snapshot?.workflowId !== request.workflowId
    ) {
      pending.current = null;
      return;
    }
    const url = snapshot.state.selfieUrl;
    if (url && url !== request.url && !selfieLinkExpired(url)) {
      pending.current = null;
      open?.(url, snapshot.workflowId);
    }
  }, [snapshot, busy, open, hostedOpen]);
  return async (url, workflowId, automatic, signal) => {
    const s = latest.current.snapshot;
    if (
      !s ||
      !workflowId ||
      s.workflowId !== workflowId ||
      (s.state.selfieUrl !== url &&
        (automatic ||
          !s.state.selfieUrl ||
          !selfieLinkExpired(s.state.selfieUrl))) ||
      latest.current.busy ||
      locked.current ||
      signal?.aborted ||
      !s.executionEnabled ||
      !s.state.validated ||
      s.state.bookingReference
    )
      throw new Error('Verification unavailable');
    const recoveryUrl = s.state.selfieUrl ?? url;
    const count = attempts.current.get(workflowId) ?? {
      total: 0,
      automatic: false,
    };
    if (count.total >= 3 || (automatic && count.automatic))
      throw new Error('Renewal limit reached');
    attempts.current.set(workflowId, {
      total: count.total + 1,
      automatic: count.automatic || automatic,
    });
    locked.current = true;
    let dispatched = false;
    let inFlight = false;
    try {
      const response = await fetchWithCsrf(
        `/api/payments/oxygen/workflows/selfie-status?workflowId=${encodeURIComponent(workflowId)}`,
        {
          cache: 'no-store',
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
            : AbortSignal.timeout(20_000),
        }
      );
      if (!response.ok) throw new Error('Status unavailable');
      const result = oxygenSelfieStatusSchema.parse(await response.json());
      if (
        !alive.current ||
        signal?.aborted ||
        latest.current.snapshot?.workflowId !== workflowId ||
        latest.current.snapshot.state.selfieUrl !== recoveryUrl ||
        latest.current.busy
      )
        throw new Error('Verification unavailable');
      if (result.confirmed) return 'confirmed';
      if (
        latest.current.snapshot?.pending ||
        latest.current.snapshot?.stage === 'reconciliation_required'
      )
        throw new Error('Reconciliation required before renewal');
      pending.current = { url: recoveryUrl, workflowId, signal };
      dispatched = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      inFlight = true;
      const submission = latest.current
        .submit({ action: 'selfie_link' })
        .finally(() => {
          inFlight = false;
          locked.current = false;
          clearTimeout(timer);
        });
      const outcome = await Promise.race([
        submission,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Renewal outcome unknown')),
            20_000
          );
        }),
      ]);
      if (!outcome) {
        throw new Error('Renewal unavailable');
      }
      return 'renewed';
    } catch (error) {
      // A lost command response can still recover a fresh canonical snapshot.
      // Keep its adoption fence; the effect checks closure and workflow identity.
      if (!dispatched) pending.current = null;
      throw error;
    } finally {
      // A timed-out POST may still commit; never overlap it with another mutation.
      if (!inFlight) locked.current = false;
    }
  };
}
