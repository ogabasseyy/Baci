'use client';
import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { fetchWithCsrf } from '@/lib/api-client';
import { oxygenActivationTrialStateSchema } from '@/schemas/oxygen-activation-trial';

const endpoint = '/api/payments/oxygen/activation-trial';
export function OxygenActivationTrial({ reference }: { reference: string }) {
  const [state, setState] = useState<z.infer<
    typeof oxygenActivationTrialStateSchema
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (reference !== '438f96ee-37c4-49bb-a56c-51451f9cb624') return;
    let cancelled = false;
    void fetchWithCsrf(endpoint, { cache: 'no-store' })
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
  }, [reference]);
  if (!state) return null;
  async function activate() {
    if (lock.current || state?.status !== 'ready') return;
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
      setError('We could not confirm activation. Do not repeat the request.');
      try {
        const response = await fetchWithCsrf(endpoint, { cache: 'no-store' });
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
  return (
    <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
        Staging activation test
      </p>
      <p className="text-sm leading-relaxed text-gray-700">
        Payment confirmation should automatically activate your payment plan.
        This button lets us test that step in staging.
      </p>
      {state.status === 'ready' && (
        <button
          type="button"
          disabled={busy || lock.current}
          onClick={() => void activate()}
          className="min-h-12 w-full rounded-xl bg-red-600 px-4 py-3 font-semibold text-white disabled:opacity-50"
        >
          {busy
            ? 'Confirming payment and activating…'
            : 'Confirm payment and activate'}
        </button>
      )}
      {state.status === 'activated' && (
        <p role="status" className="font-semibold text-emerald-800">
          Payment plan activated
        </p>
      )}
      {['queued', 'executing', 'indeterminate'].includes(state.status) && (
        <p role="status" className="text-sm text-amber-900">
          Activation is awaiting confirmation. Don’t repeat the request.
        </p>
      )}
      {state.status === 'rejected' && (
        <p role="status" className="text-sm text-red-700">
          Activation was not completed. The response has been saved for review.
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
