'use client';
import { useEffect, useRef, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import { trackOxygenJourney } from '@/lib/payments/oxygen/journey-events';
import { OxygenPaymentOriginUnverifiedError } from '@/lib/payments/oxygen/payment-origin-error';
import type { OxygenRuntimeAction } from '@/schemas/oxygen-runtime';
import {
  type OxygenRuntimeSnapshot,
  oxygenRuntimeSnapshotSchema,
} from '@/schemas/oxygen-runtime-view';
import {
  canReplaceQueuedAddress,
  retireQueuedAddress,
  selectOxygenActionKey,
} from './oxygen-address-recovery';
import { mayRetryFailedSelfie } from './oxygen-failed-selfie-retry';
import { isLegacyApprovalQueued } from './oxygen-legacy-approval-queued';
import { oxygenPendingActionBlocked } from './oxygen-pending-action-blocked';
import { retireQueuedPhoneVerification } from './oxygen-phone-recovery';
import {
  decodeOxygenResponse as decode,
  SignInRequired,
} from './oxygen-provider-response';
import { pendingReadRecovery } from './oxygen-read-recovery';
import { retireLegacyQueuedApproval } from './oxygen-retire-legacy-approval';
import { oxygenSubmitErrorMessage } from './oxygen-submit-error-message';

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
  const [safeSelfieRetry, setSafeSelfieRetry] = useState(false);
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
    setSafeSelfieRetry(false);
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
            failure instanceof OxygenPaymentOriginUnverifiedError
              ? failure.message
              : 'Unable to load your finance application. Try again to continue.'
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
      command.action === 'submit_address' &&
      snapshot.pending &&
      !canReplaceQueuedAddress(snapshot)
    )
      return false;
    if (oxygenPendingActionBlocked(snapshot, command.action)) {
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
    setSafeSelfieRetry(false);
    setErrorAction(null);
    trackOxygenJourney(
      'action_started',
      orderId,
      snapshot.stage,
      command.action
    );
    const pending = snapshot.pending;
    const key =
      command.action === 'refresh_eligibility' &&
      isLegacyApprovalQueued(snapshot)
        ? crypto.randomUUID()
        : selectOxygenActionKey(
            command.action,
            snapshot,
            lastKey.current,
            pendingReadRecovery(snapshot)
          );
    lastKey.current = {
      action: command.action,
      version: snapshot.version,
      key,
    };
    try {
      if (
        command.action === 'refresh_eligibility' &&
        pending &&
        isLegacyApprovalQueued(snapshot)
      )
        await retireLegacyQueuedApproval(snapshot);
      if (command.action === 'submit_address' && pending)
        await retireQueuedAddress(snapshot, command, file);
      if (
        command.action === 'resend_customer_otp' &&
        pending?.action === 'validate_customer' &&
        pending.status === 'queued'
      ) {
        await retireQueuedPhoneVerification(
          snapshot.workflowId,
          snapshot.version,
          pending.idempotencyKey
        );
      }
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
        setSafeSelfieRetry(
          command.action === 'selfie_link' &&
            mayRetryFailedSelfie(snapshot, recovered)
        );
        setErrorAction(command.action);
        setError(oxygenSubmitErrorMessage(failure, command.action, recovered));
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
        setSafeSelfieRetry(false);
      }
    } catch (failure) {
      if (alive.current && token === generation.current) {
        setNeedsSignIn(failure instanceof SignInRequired);
        setError(
          failure instanceof OxygenPaymentOriginUnverifiedError
            ? failure.message
            : 'We couldn’t check for an update. Your progress is saved.'
        );
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
    safeSelfieRetry,
    clearError: () => setError(''),
    submit,
    refresh,
    readSaved,
    needsSignIn,
  };
}
