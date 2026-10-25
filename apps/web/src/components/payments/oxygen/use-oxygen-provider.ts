'use client';
import { useEffect, useRef, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  oxygenActiveLoanCode,
  oxygenActiveLoanMessage,
  oxygenStatementRequiredCode,
  oxygenStatementRequiredMessage,
} from '@/lib/payments/oxygen/booking-rejection';
import { trackOxygenJourney } from '@/lib/payments/oxygen/journey-events';
import {
  oxygenInvalidOtpCode,
  oxygenInvalidOtpMessage,
} from '@/lib/payments/oxygen/otp-rejection';
import type { OxygenRuntimeAction } from '@/schemas/oxygen-runtime';
import {
  type OxygenRuntimeSnapshot,
  oxygenRuntimeSnapshotSchema,
} from '@/schemas/oxygen-runtime-view';

const base = '/api/payments/oxygen/workflows';
class SignInRequired extends Error {}
class OxygenRateLimitError extends Error {}
class OxygenInvalidOtpError extends Error {}
export const oxygenRateLimitMessage =
  'Please wait a moment before trying again.';
async function decode(response: Response): Promise<unknown> {
  if (response.status === 401) throw new SignInRequired();
  if (response.status === 429)
    throw new OxygenRateLimitError(oxygenRateLimitMessage);
  if (response.status === 409) {
    const body: unknown = await response.json().catch(() => null);
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === oxygenActiveLoanCode
    )
      throw new Error(oxygenActiveLoanMessage);
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === oxygenInvalidOtpCode
    )
      throw new OxygenInvalidOtpError(oxygenInvalidOtpMessage);
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === oxygenStatementRequiredCode
    )
      throw new Error(oxygenStatementRequiredMessage);
  }
  if (!response.ok)
    throw new Error(
      'We couldn’t complete this step right now. Your progress is saved.'
    );
  return response.json() as Promise<unknown>;
}
async function fetchSnapshot(id: string) {
  return oxygenRuntimeSnapshotSchema.parse(
    await decode(
      await fetchWithCsrf(`${base}/actions?workflowId=${id}`, {
        cache: 'no-store',
      })
    )
  );
}
export function useOxygenProvider(orderId: string) {
  const [snapshot, setSnapshot] = useState<OxygenRuntimeSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [errorAction, setErrorAction] = useState<
    OxygenRuntimeAction['action'] | null
  >(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const locked = useRef(false);
  const workflow = useRef('');
  const lastKey = useRef<{
    action: string;
    version: number;
    key: string;
  } | null>(null);
  async function read() {
    const token = ++generation.current;
    const result = await fetchSnapshot(workflow.current);
    if (alive.current && token === generation.current) setSnapshot(result);
    return result;
  }
  useEffect(() => {
    alive.current = true;
    const token = ++generation.current;
    async function resume() {
      try {
        const result = (await decode(
          await fetchWithCsrf(base, {
            method: 'POST',
            body: JSON.stringify({ orderId, channel: 'web' }),
            cache: 'no-store',
          })
        )) as { workflow?: { id?: string } };
        if (!result.workflow?.id) throw new Error('Workflow unavailable');
        workflow.current = result.workflow.id;
        const saved = await fetchSnapshot(workflow.current);
        if (alive.current && token === generation.current) setSnapshot(saved);
      } catch (failure) {
        if (alive.current && token === generation.current) {
          trackOxygenJourney('load_failed', orderId, 'loading');
          setNeedsSignIn(failure instanceof SignInRequired);
          setError(
            'Unable to load your finance application. Sign in and refresh to continue.'
          );
        }
      } finally {
        if (alive.current && token === generation.current) setBusy(false);
      }
    }
    void resume();
    return () => {
      alive.current = false;
    };
    // The keyed session is recreated when the order changes.
  }, [orderId]);
  async function submit(
    command: OxygenRuntimeAction,
    file?: File,
    onConfirmed?: () => Promise<void>
  ) {
    if (locked.current || !snapshot?.executionEnabled) return false;
    if (
      snapshot.pending?.status === 'queued' &&
      snapshot.pending.action !== command.action
    ) {
      setError('Complete the previous step first.');
      return false;
    }
    ++generation.current;
    locked.current = true;
    setBusy(true);
    setError('');
    setErrorAction(null);
    trackOxygenJourney(
      'action_started',
      orderId,
      snapshot.stage,
      command.action
    );
    const pending = snapshot.pending;
    const key =
      pending?.status === 'queued' && pending.action === command.action
        ? pending.idempotencyKey
        : lastKey.current?.action === command.action &&
            lastKey.current.version === snapshot.version
          ? lastKey.current.key
          : crypto.randomUUID();
    lastKey.current = {
      action: command.action,
      version: snapshot.version,
      key,
    };
    try {
      const payload = {
        workflowId: snapshot.workflowId,
        version: snapshot.version,
        idempotencyKey: key,
        command,
      };
      let body: string | FormData = JSON.stringify(payload);
      if (file) {
        if (file.size > 1_572_864)
          throw new Error('Use a document smaller than 1.5 MB.');
        const form = new FormData();
        form.set('payload', body);
        form.set('file', file);
        body = form;
      }
      const result = oxygenRuntimeSnapshotSchema.parse(
        await decode(
          await fetchWithCsrf(`${base}/actions`, {
            method: 'POST',
            body,
            cache: 'no-store',
          })
        )
      );
      const confirmed =
        result.workflowId === snapshot.workflowId &&
        result.version > snapshot.version &&
        !result.pending &&
        result.stage !== 'reconciliation_required' &&
        (command.action !== 'approve_booking' ||
          (result.state?.booking?.status === 'APPROVED' &&
            result.state.bookingReference ===
              snapshot.state?.bookingReference &&
            result.stage === 'payment_required'));
      if (confirmed && onConfirmed) await onConfirmed();
      if (alive.current) setSnapshot(result);
      trackOxygenJourney(
        'action_response_received',
        orderId,
        result.stage,
        command.action
      );
      return confirmed;
    } catch (failure) {
      trackOxygenJourney(
        'action_unconfirmed',
        orderId,
        snapshot.stage,
        command.action
      );
      // Status reads never repeat the mutation or infer success from a redirect.
      let recovered: OxygenRuntimeSnapshot | null = null;
      try {
        recovered = await read();
      } catch {
        /* Preserve last known snapshot. */
      }
      if (alive.current) {
        setErrorAction(command.action);
        setError(
          failure instanceof OxygenRateLimitError
            ? oxygenRateLimitMessage
            : failure instanceof OxygenInvalidOtpError
              ? oxygenInvalidOtpMessage
              : command.action === 'validate_customer' &&
                  !recovered?.pending &&
                  recovered?.stage !== 'reconciliation_required'
                ? 'We couldn’t check your code right now. Please try again shortly.'
                : command.action === 'resend_customer_otp'
                  ? 'We couldn’t send a new code right now. Please wait a moment and try again.'
                  : failure instanceof Error
                    ? failure.message
                    : 'We couldn’t complete this step. Your progress is saved.'
        );
      }
      return false;
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function refresh() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await read();
      if (alive.current) {
        setError('');
        setErrorAction(null);
      }
    } catch {
      if (alive.current)
        setError('We couldn’t check for an update. Your progress is saved.');
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return {
    snapshot,
    busy,
    error,
    errorAction,
    clearError: () => setError(''),
    submit,
    refresh,
    needsSignIn,
  };
}
