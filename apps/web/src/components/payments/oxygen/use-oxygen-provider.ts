'use client';
import { useEffect, useRef, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import { trackOxygenJourney } from '@/lib/payments/oxygen/journey-events';
import { oxygenInvalidOtpMessage } from '@/lib/payments/oxygen/otp-rejection';
import type { OxygenRuntimeAction } from '@/schemas/oxygen-runtime';
import {
  type OxygenRuntimeSnapshot,
  oxygenRuntimeSnapshotSchema,
} from '@/schemas/oxygen-runtime-view';
import {
  decodeOxygenResponse as decode,
  OxygenInvalidOtpError,
  OxygenRateLimitError,
  oxygenRateLimitMessage,
  SignInRequired,
} from './oxygen-provider-response';
import { pendingReadRecovery } from './oxygen-read-recovery';

export { oxygenRateLimitMessage } from './oxygen-provider-response';

import {
  fetchOxygenSnapshot,
  initializeOxygenWorkflow,
} from './oxygen-workflow-initialization';
import { rememberPhoneOtpSend } from './phone-otp-window';

const base = '/api/payments/oxygen/workflows';
type LastKey = { action: string; version: number; key: string };
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
  const locked = useRef<symbol | null>(null);
  const scope = useRef(0);
  const workflow = useRef('');
  const lastKey = useRef<LastKey | null>(null);
  async function read() {
    const token = ++generation.current;
    let id = workflow.current;
    if (!id) {
      id = await initializeOxygenWorkflow(orderId, decode);
      if (!alive.current || token !== generation.current) return null;
      workflow.current = id;
    }
    const result = await fetchOxygenSnapshot(id, decode);
    if (!alive.current || token !== generation.current) return null;
    setSnapshot(result);
    return result;
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: read is bound to this order and must not restart on each render
  useEffect(() => {
    alive.current = true;
    workflow.current = '';
    locked.current = null;
    ++scope.current;
    setSnapshot(null);
    setError('');
    setNeedsSignIn(false);
    setBusy(true);
    const token = generation.current + 1;
    async function resume() {
      try {
        await read();
      } catch (failure) {
        if (alive.current && token === generation.current) {
          trackOxygenJourney('load_failed', orderId, 'loading');
          setNeedsSignIn(failure instanceof SignInRequired);
          setError(
            'Unable to load your finance application. Try again to continue.'
          );
        }
      } finally {
        if (alive.current && token === generation.current) setBusy(false);
      }
    }
    void resume();
    return () => {
      alive.current = false;
      ++generation.current;
    };
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
    const requestedAt = Date.now();
    ++generation.current;
    const lock = Symbol();
    const requestScope = scope.current;
    locked.current = lock;
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
    const isNin = command.action === 'validate_nin';
    const key =
      pending?.status === 'queued' && pending.action === command.action
        ? pending.idempotencyKey
        : !(
              pending?.status === 'executing' &&
              pendingReadRecovery(snapshot) === command.action
            ) &&
            !(isNin && snapshot.ninAttemptStatus === 'safe_retry') &&
            lastKey.current?.action === command.action &&
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
      if (!alive.current || requestScope !== scope.current) return false;
      const confirmed =
        result.workflowId === snapshot.workflowId &&
        result.version > snapshot.version &&
        !result.pending &&
        result.stage !== 'reconciliation_required' &&
        (command.action !== 'validate_customer' ||
          result.state.validated === true) &&
        (command.action !== 'approve_booking' ||
          (result.state?.booking?.status === 'APPROVED' &&
            result.state.bookingReference ===
              snapshot.state?.bookingReference &&
            result.stage === 'payment_required'));
      if (
        confirmed &&
        (command.action === 'start_application' ||
          command.action === 'resend_customer_otp')
      )
        rememberPhoneOtpSend(snapshot.workflowId, requestedAt);
      if (confirmed && onConfirmed) await onConfirmed();
      if (!alive.current || requestScope !== scope.current) return false;
      setSnapshot(result);
      trackOxygenJourney(
        'action_response_received',
        orderId,
        result.stage,
        command.action
      );
      return confirmed;
    } catch (failure) {
      if (!alive.current || requestScope !== scope.current) return false;
      trackOxygenJourney(
        'action_unconfirmed',
        orderId,
        snapshot.stage,
        command.action
      );
      let recovered: OxygenRuntimeSnapshot | null = null;
      try {
        recovered = await read();
      } catch {
        /* Preserve last known snapshot. */
      }
      if (alive.current && requestScope === scope.current) {
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
      if (locked.current === lock) locked.current = null;
      if (alive.current && requestScope === scope.current) setBusy(false);
    }
  }
  async function readSaved() {
    if (locked.current || !workflow.current) return;
    const lock = Symbol();
    locked.current = lock;
    try {
      await read();
    } finally {
      if (locked.current === lock) locked.current = null;
    }
  }
  async function refresh() {
    if (locked.current) return;
    const lock = Symbol();
    locked.current = lock;
    setBusy(true);
    const token = generation.current + 1;
    try {
      const result = await read();
      if (alive.current && result) {
        setNeedsSignIn(false);
        setError('');
        setErrorAction(null);
      }
    } catch (failure) {
      if (alive.current && token === generation.current) {
        setNeedsSignIn(failure instanceof SignInRequired);
        setError('We couldn’t check for an update. Your progress is saved.');
      }
    } finally {
      if (locked.current === lock) locked.current = null;
      if (alive.current && token === generation.current) setBusy(false);
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
    readSaved,
    needsSignIn,
  };
}
