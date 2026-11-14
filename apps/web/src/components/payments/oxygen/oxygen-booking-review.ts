import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';

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
