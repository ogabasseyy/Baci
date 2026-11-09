'use client';
import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { fetchWithCsrf } from '@/lib/api-client';
import { oxygenActivationTrialStateSchema } from '@/schemas/oxygen-activation-trial';

const endpoint = '/api/payments/oxygen/activation-trial';
export function OxygenActivationTrial({
  reference,
  onActivated,
}: {
  reference: string;
  onActivated?: () => void;
}) {
  const [state, setState] = useState<z.infer<
    typeof oxygenActivationTrialStateSchema
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const statusEndpoint = `${endpoint}?reference=${encodeURIComponent(reference)}`;
  useEffect(() => {
    let cancelled = false;
    void fetchWithCsrf(statusEndpoint, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const data = oxygenActivationTrialStateSchema.parse(
          await response.json()
        );
        if (!cancelled) setState(data);
      })
      .catch(() => {
        /* A missing trial must not interrupt normal checkout. */
      });
    return () => {
      cancelled = true;
    };
  }, [statusEndpoint]);
  useEffect(() => {
    if (
      lock.current ||
      !state ||
      (state.status !== 'ready' &&
        !(state.status === 'activated' && !state.orderConfirmed))
    )
      return;
    async function activate() {
      lock.current = true;
      setBusy(true);
      setError('');
      try {
        const response = await fetchWithCsrf(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference }),
        });
        if (!response.ok) throw new Error('Unconfirmed');
        setState(oxygenActivationTrialStateSchema.parse(await response.json()));
      } catch {
        setError(
          'We couldn’t confirm your payment plan. Your payment is saved; please contact support.'
        );
        try {
          const response = await fetchWithCsrf(statusEndpoint, {
            cache: 'no-store',
          });
          if (response.ok)
            setState(
              oxygenActivationTrialStateSchema.parse(await response.json())
            );
        } catch {
          /* Retain the one-use lock after response loss. */
        }
      } finally {
        setBusy(false);
      }
    }
    void activate();
  }, [state, reference, statusEndpoint]);
  useEffect(() => {
    if (!['queued', 'executing'].includes(state?.status ?? '')) return;
    let cancelled = false;
    let inFlight = false;
    let reads = 0;
    const timer = setInterval(async () => {
      if (inFlight) return;
      if (++reads > 15) {
        clearInterval(timer);
        return;
      }
      inFlight = true;
      try {
        const response = await fetchWithCsrf(statusEndpoint, {
          cache: 'no-store',
        });
        if (response.ok && !cancelled)
          setState(
            oxygenActivationTrialStateSchema.parse(await response.json())
          );
      } catch {
        /* Status reads never replay activation. */
      } finally {
        inFlight = false;
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state?.status, statusEndpoint]);
  const advanced = useRef<string | null>(null);
  useEffect(() => {
    if (
      !onActivated ||
      state?.status !== 'activated' ||
      !state.orderConfirmed ||
      state.result.loan_reference !== reference ||
      state.result.status !== 'ACTIVATED' ||
      advanced.current === reference
    )
      return;
    advanced.current = reference;
    onActivated();
  }, [onActivated, reference, state]);
  if (!state) return null;
  return (
    <div className="space-y-3 rounded-2xl border border-gray-100 bg-gray-50 p-4">
      {busy && (
        <p role="status" className="text-sm font-medium text-gray-700">
          Finalising your order…
        </p>
      )}
      {state.status === 'activated' && state.orderConfirmed && (
        <p role="status" className="font-semibold text-emerald-800">
          Payment plan confirmed
        </p>
      )}
      {(['queued', 'executing', 'indeterminate'].includes(state.status) ||
        (state.status === 'activated' && !state.orderConfirmed)) && (
        <p role="status" className="text-sm text-amber-900">
          Your payment is confirmed. We’re waiting for Oxygen to confirm your
          payment plan. You don’t need to pay again.
        </p>
      )}
      {state.status === 'rejected' && (
        <p role="status" className="text-sm text-red-700">
          Your payment is confirmed, but we couldn’t finalise your payment plan.
          Please contact support. You don’t need to pay again.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
