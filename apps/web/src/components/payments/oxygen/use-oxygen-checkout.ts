'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  OxygenCheckoutAdapter,
  OxygenCheckoutSnapshot,
  OxygenHostedStep,
} from '@/lib/payments/oxygen/checkout';

export function useOxygenCheckout(adapter: OxygenCheckoutAdapter) {
  const [snapshot, setSnapshot] = useState<OxygenCheckoutSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const locked = useRef(true);
  useEffect(() => {
    const current = ++generation.current;
    locked.current = true;
    setSnapshot(null);
    setBusy(true);
    setError(null);
    void Promise.resolve()
      .then(() => adapter.load())
      .then((value) => {
        if (current === generation.current) setSnapshot(value);
      })
      .catch(() => {
        if (current === generation.current)
          setError('Unable to load the plan. Please try again.');
      })
      .finally(() => {
        if (current === generation.current) {
          locked.current = false;
          setBusy(false);
        }
      });
    return () => {
      generation.current++;
    };
  }, [adapter]);

  async function run(operation: () => Promise<OxygenCheckoutSnapshot>) {
    if (locked.current) return;
    const current = generation.current;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await operation();
      if (current === generation.current) setSnapshot(result);
    } catch {
      if (current === generation.current)
        setError(
          'Unable to complete this step. Check the status and try again.'
        );
    } finally {
      if (current === generation.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  return {
    snapshot,
    busy,
    error,
    reload: () => run(() => adapter.load()),
    accept: () =>
      snapshot && run(() => adapter.acceptOffer(snapshot.bookingReference)),
    replace: (percentage: number) =>
      snapshot &&
      run(() => adapter.replaceBooking(snapshot.bookingReference, percentage)),
    check: () =>
      snapshot && run(() => adapter.checkCompletion(snapshot.bookingReference)),
    completeHosted: (step: OxygenHostedStep) =>
      snapshot &&
      run(async () => {
        await adapter.simulateHostedCompletion(snapshot.bookingReference, step);
        return adapter.checkCompletion(snapshot.bookingReference);
      }),
    confirm: () =>
      snapshot && run(() => adapter.confirmPreview(snapshot.bookingReference)),
  };
}
