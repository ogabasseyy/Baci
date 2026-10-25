'use client';
import { useEffect, useRef } from 'react';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import type { SubmitOxygenForm } from './OxygenVerificationForms';

/** Read-only provider lookups; never approves, cancels, pays, activates or settles. */
export function useOxygenBookingProgress(
  snapshot: OxygenRuntimeSnapshot | null,
  busy: boolean,
  error: string,
  enabled: boolean,
  addressSubmitted: boolean,
  submit: SubmitOxygenForm
) {
  const attempts = useRef(new Map<string, number>());
  useEffect(() => {
    if (!enabled) {
      attempts.current.clear();
      return;
    }
    const booking = snapshot?.state.bookingReference;
    if (
      !booking ||
      !enabled ||
      busy ||
      error ||
      !snapshot.executionEnabled ||
      snapshot.pending
    )
      return;
    let action: 'refresh_details' | 'refresh_kyc' | 'refresh_payment_setup';
    if (snapshot.state.booking && !snapshot.state.schedule)
      action = 'refresh_details';
    else if (snapshot.stage === 'booked') action = 'refresh_kyc';
    else if (snapshot.stage === 'payment_required')
      action = 'refresh_payment_setup';
    else return;
    const key = `${booking}:${action}`;
    const count = attempts.current.get(key) ?? 0;
    const limit = action === 'refresh_details' ? 1 : 5;
    if (count >= limit) return;
    if (
      action === 'refresh_kyc' &&
      count > 0 &&
      !addressSubmitted &&
      snapshot.state.kyc?.address_status !== 'PROCESSING'
    )
      return;
    const timer = window.setTimeout(
      () => {
        attempts.current.set(key, count + 1);
        void submit({ action });
      },
      count === 0 ? 0 : 20_000
    );
    return () => window.clearTimeout(timer);
  }, [snapshot, busy, error, enabled, addressSubmitted, submit]);
}
