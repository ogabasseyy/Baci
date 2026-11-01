'use client';
import { useEffect, useRef, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  type OxygenSavedPlans,
  oxygenSavedPlansSchema,
} from '@/schemas/oxygen-saved-plans';

const endpoint = '/api/payments/oxygen/plans';
async function decode(response: Response) {
  if (!response.ok) throw new Error('Saved plans unavailable');
  return oxygenSavedPlansSchema.parse(await response.json());
}
export function useOxygenSavedPlans(workflowId: string) {
  const [data, setData] = useState<OxygenSavedPlans | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [quoting, setQuoting] = useState(false);
  const quotePending = useRef(false);
  const alive = useRef(false);
  const pending = useRef<string | null>(null);
  const saving = useRef(false);
  const preferenceWaiters = useRef<Array<() => void>>([]);
  const revision = useRef(0);
  const [reloadCount, setReloadCount] = useState(0);
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    const at = revision.current;
    async function load() {
      try {
        const value = await decode(
          await fetchWithCsrf(
            `${endpoint}?workflowId=${workflowId}&retry=${reloadCount}`,
            {
              cache: 'no-store',
            }
          )
        );
        if (!disposed && revision.current === at) {
          setData(value);
          setSelected(value.selectedReference);
          setError('');
        }
      } catch {
        if (!disposed)
          setError(
            'Saved plan choices are unavailable. Your application is preserved.'
          );
      }
    }
    void load();
    return () => {
      disposed = true;
      alive.current = false;
    };
  }, [workflowId, reloadCount]);
  async function select(reference: string) {
    revision.current++;
    pending.current = reference;
    setSelected(reference);
    setError('');
    if (saving.current) return;
    saving.current = true;
    try {
      while (pending.current && alive.current) {
        const next = pending.current;
        pending.current = null;
        try {
          await decode(
            await fetchWithCsrf(endpoint, {
              method: 'POST',
              body: JSON.stringify({ workflowId, bookingReference: next }),
              cache: 'no-store',
            })
          );
          if (alive.current && !pending.current) setError('');
        } catch {
          if (alive.current)
            setError(
              'Your choice could not be saved. Retry saving it before continuing.'
            );
        }
      }
    } finally {
      saving.current = false;
      for (const resolve of preferenceWaiters.current.splice(0)) resolve();
    }
  }
  async function quote(equityPercentage: number, tenure: number) {
    if (quotePending.current) return;
    quotePending.current = true;
    setQuoting(true);
    setError('');
    revision.current++;
    try {
      if (saving.current)
        await new Promise<void>((resolve) =>
          preferenceWaiters.current.push(resolve)
        );
      if (!alive.current) return;
      const value = await decode(
        await fetchWithCsrf(`${endpoint}/quote`, {
          method: 'POST',
          signal: AbortSignal.timeout(90_000),
          cache: 'no-store',
          body: JSON.stringify({
            workflowId,
            equityPercentage,
            tenure,
            idempotencyKey: crypto.randomUUID(),
          }),
        })
      );
      if (alive.current) {
        setData(value);
        setSelected(value.selectedReference);
      }
    } catch {
      if (alive.current)
        setError(
          'This plan could not be confirmed. Your application is saved. Retry to check its breakdown; uncertain bookings will not be repeated.'
        );
    } finally {
      quotePending.current = false;
      if (alive.current) setQuoting(false);
    }
  }
  return {
    data,
    quoting,
    quote,
    selected,
    error,
    select,
    reload: () => setReloadCount((value) => value + 1),
  };
}
