'use client';
import { useContext, useEffect, useRef, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  type OxygenPaymentRecoveryRequest,
  type OxygenPaymentRecoveryState,
  oxygenPaymentRecoveryStateSchema,
} from '@/schemas/oxygen-payment-recovery';

import {
  OxygenPaymentOpenContext,
  OxygenPaymentSurfaceContext,
} from './OxygenPaymentSurfaceContext';
import { useOxygenPaymentReturn } from './use-oxygen-payment-return';
import { useOxygenPaymentWatch } from './use-oxygen-payment-watch';

const endpoint = '/api/payments/oxygen/recovery';
export function useOxygenPaymentRecovery(
  workflowId: string,
  reference: string,
  version: number
) {
  const [state, setState] = useState<OxygenPaymentRecoveryState | null>(null);
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paymentUrl, setLocalPaymentUrl] = useState<string | null>(null);
  const setHostedPaymentUrl = useContext(OxygenPaymentSurfaceContext);
  const hostedPaymentOpen = useContext(OxygenPaymentOpenContext);
  const setPaymentUrl = setHostedPaymentUrl ?? setLocalPaymentUrl;
  const lock = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setState(null);
    setWatching(false);
    setPaymentUrl(null);
    setBusy(false);
    setError('');
    void fetchWithCsrf(`${endpoint}?workflowId=${workflowId}`, {
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unavailable');
        const data = oxygenPaymentRecoveryStateSchema.parse(
          await response.json()
        );
        if (data.reference !== reference) throw new Error('Reference changed');
        if (generation.current === current) setState(data);
      })
      .catch(() => {
        if (generation.current === current)
          setError(
            'We could not load your saved payment step. Please try continuing again.'
          );
      });
    return () => {
      ++generation.current;
    };
  }, [workflowId, reference, setPaymentUrl]);
  async function run(
    action: OxygenPaymentRecoveryRequest['action'],
    continuePayment = false,
    cachedOnly = false
  ) {
    if (lock.current || (state?.pending && action !== 'check_status')) return;
    lock.current = true;
    if (!cachedOnly) {
      setBusy(true);
      setError('');
    }
    const current = generation.current;
    try {
      async function request(
        nextAction: OxygenPaymentRecoveryRequest['action'],
        cached = false
      ) {
        const response = cached
          ? await fetchWithCsrf(`${endpoint}?workflowId=${workflowId}`, {
              cache: 'no-store',
            })
          : await fetchWithCsrf(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                workflowId,
                reference,
                version,
                idempotencyKey: crypto.randomUUID(),
                action: nextAction,
              }),
            });
        if (!response.ok) throw new Error('Unconfirmed');
        const data = oxygenPaymentRecoveryStateSchema.parse(
          await response.json()
        );
        if (data.reference !== reference || generation.current !== current)
          throw new Error('Reference changed');
        return data;
      }
      const linkFor = (data: OxygenPaymentRecoveryState) =>
        data.paymentComplete
          ? data.setupComplete
            ? null
            : data.setupUrl
          : data.paymentUrl;
      let data = state;
      if (!continuePayment || !data || !linkFor(data) || data.pending) {
        data = await request(action, cachedOnly || state?.pending);
      }
      if (
        continuePayment &&
        !data.pending &&
        !linkFor(data) &&
        !(data.paymentComplete && data.setupComplete)
      ) {
        if (
          data.resendBlocked ||
          !data.checkedAt ||
          data.paymentComplete === null ||
          (data.paymentComplete && data.setupComplete === null)
        )
          throw new Error('Unconfirmed');
        data = await request(
          data.paymentComplete ? 'resend_repayment' : 'resend_upfront'
        );
      }
      if (continuePayment && !data.pending && generation.current === current) {
        setPaymentUrl(linkFor(data));
        setWatching(true);
      }
      if (generation.current === current) setState(data);
    } catch {
      if (cachedOnly) return;
      if (generation.current === current) {
        setError(
          'We could not confirm your payment yet. Your plan is saved; no payment has been assumed.'
        );
        try {
          const response = await fetchWithCsrf(
            `${endpoint}?workflowId=${workflowId}`,
            { cache: 'no-store' }
          );
          if (response.ok) {
            const data = oxygenPaymentRecoveryStateSchema.parse(
              await response.json()
            );
            if (data.reference === reference && generation.current === current)
              setState(data);
          }
        } catch {
          /* Keep the last confirmed state. */
        }
      }
    } finally {
      lock.current = false;
      if (generation.current === current) setBusy(false);
    }
  }
  useEffect(() => {
    if (state?.paymentComplete && state.setupComplete && !state.pending)
      setPaymentUrl(null);
  }, [
    state?.paymentComplete,
    state?.setupComplete,
    state?.pending,
    setPaymentUrl,
  ]);
  const complete =
    state?.paymentComplete === true &&
    state?.setupComplete === true &&
    !state?.pending;
  const confirmationDelayed = useOxygenPaymentWatch(
    watching,
    complete,
    () => run('check_status', false, true),
    () => run('check_status')
  );
  useOxygenPaymentReturn(
    hostedPaymentOpen || Boolean(paymentUrl),
    complete,
    () => {
      setWatching(true);
      void run('check_status');
    }
  );
  return {
    state,
    awaitingConfirmation:
      watching &&
      !hostedPaymentOpen &&
      !paymentUrl &&
      !complete &&
      state?.paymentComplete !== true,
    confirmationDelayed,
    busy,
    error,
    paymentUrl,
    closePayment: () => setPaymentUrl(null),
    run,
  };
}
