import { bookedPlanIsOffered } from '@/lib/payments/oxygen/booked-plan-offer';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';

export function canRefreshSavedOxygenOffers(
  snapshot: OxygenRuntimeSnapshot
): boolean {
  const state = snapshot.state;
  return Boolean(
    ['booked', 'approval_required'].includes(snapshot.stage) &&
      state?.booking?.status === 'BOOKED' &&
      !bookedPlanIsOffered(state) &&
      !snapshot.pending &&
      !state.paymentComplete &&
      !state.setupComplete
  );
}
