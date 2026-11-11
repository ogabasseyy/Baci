import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';

export function canRefreshSavedOxygenOffers(
  snapshot: OxygenRuntimeSnapshot
): boolean {
  const state = snapshot.state;
  return Boolean(
    ['booked', 'approval_required'].includes(snapshot.stage) &&
      state?.booking?.status === 'BOOKED' &&
      !state.offers &&
      !snapshot.pending &&
      !state.paymentComplete &&
      !state.setupComplete
  );
}

export function shouldReviewOxygenBooking(
  snapshot: OxygenRuntimeSnapshot | null,
  acceptedReference?: string
): boolean {
  const state = snapshot?.state;
  return Boolean(
    (snapshot?.stage === 'booked' ||
      (snapshot?.stage === 'approval_required' &&
        !snapshot.approvalOtpReady)) &&
      state?.booking?.status === 'BOOKED' &&
      state.bookingReference &&
      acceptedReference !== state.bookingReference
  );
}
