'use client';
import { useEffect, useRef, useState } from 'react';
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
  const [pausedAddress, setPausedAddress] = useState<string | null>(null);
  const booking = snapshot?.state.bookingReference;
  const addressReview = Boolean(
    snapshot?.stage === 'booked' &&
      booking &&
      (addressSubmitted || snapshot.state.kyc?.address_status === 'PROCESSING')
  );
  const addressKey = `${booking}:refresh_kyc:address_review`;
  useEffect(() => {
    if (!enabled) {
      attempts.current.clear();
      setPausedAddress(null);
      return;
    }
    if (
      !booking ||
      busy ||
      error ||
      !snapshot?.executionEnabled ||
      snapshot.pending
    )
      return;
    let action: 'refresh_details' | 'refresh_kyc' | 'refresh_payment_setup';
    // Address confirmation must not be starved by a missing repayment schedule.
    if (addressReview) action = 'refresh_kyc';
    else if (
      snapshot.state.booking &&
      !snapshot.state.schedule &&
      !attempts.current.has(`${booking}:refresh_details`)
    )
      action = 'refresh_details';
    else if (snapshot.stage === 'booked') action = 'refresh_kyc';
    else if (snapshot.stage === 'payment_required')
      action = 'refresh_payment_setup';
    else return;
    const key = addressReview ? addressKey : `${booking}:${action}`;
    const count = attempts.current.get(key) ?? 0;
    const limit = action === 'refresh_details' ? 1 : 5;
    if (count >= limit) {
      if (addressReview) setPausedAddress(key);
      return;
    }
    if (action === 'refresh_kyc' && count > 0 && !addressReview) return;
    const timer = window.setTimeout(
      () => {
        attempts.current.set(key, count + 1);
        void submit({ action });
      },
      count === 0 ? 0 : 20_000
    );
    return () => window.clearTimeout(timer);
  }, [
    snapshot,
    booking,
    busy,
    error,
    enabled,
    addressReview,
    addressKey,
    submit,
  ]);
  async function checkAddress() {
    if (
      !enabled ||
      busy ||
      snapshot?.pending ||
      !snapshot?.executionEnabled ||
      !addressReview
    )
      return;
    // Once automatic checks are exhausted, a manual status read must not
    // restart another long animation/polling window for the same review.
    if (pausedAddress !== addressKey) {
      attempts.current.set(addressKey, 1);
      setPausedAddress(null);
    }
    await submit({ action: 'refresh_kyc' });
  }
  return {
    manualReviewNeeded:
      enabled &&
      !busy &&
      !error &&
      addressReview &&
      pausedAddress === addressKey &&
      snapshot?.state.kyc?.address_status === 'PROCESSING',
    addressStatusUnavailable: addressReview && Boolean(error),
    addressDelayed:
      enabled &&
      !busy &&
      addressReview &&
      (Boolean(error) || pausedAddress === addressKey),
    restartAddressReview: () => {
      attempts.current.delete(addressKey);
      setPausedAddress(null);
    },
    checkAddress,
  };
}
