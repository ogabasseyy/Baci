import {
  type OxygenRuntimeSnapshot,
  oxygenEligibilityPrerequisites,
  pendingReadRecovery,
} from '@baci/shared/oxygen';
export function oxygenSelfieRequired(snapshot: OxygenRuntimeSnapshot) {
  return (
    ['kyc_required', 'eligibility_required'].includes(snapshot.stage) &&
    Boolean(snapshot.state.validated) &&
    !snapshot.state.bookingReference &&
    snapshot.state.kyc?.selfie_status !== 'DONE'
  );
}
export function oxygenRecoveryMode(
  snapshot: OxygenRuntimeSnapshot
): 'address' | 'phone' | 'recover' | 'read' {
  if (
    !snapshot.executionEnabled ||
    snapshot.stage === 'activated' ||
    snapshot.stage === 'reconciliation_required'
  )
    return 'read';
  if (
    snapshot.pending?.status === 'queued' &&
    snapshot.pending.action === 'validate_customer' &&
    !snapshot.state.validated &&
    snapshot.state.applicationReference &&
    !snapshot.state.bookingReference
  )
    return 'phone';
  const action = pendingReadRecovery(snapshot);
  return action === 'submit_address' ? 'address' : action ? 'recover' : 'read';
}
export function oxygenUnfinishedPayment(snapshot: OxygenRuntimeSnapshot) {
  const s = snapshot.state;
  if (snapshot.pending) return null;
  if (!s.paymentComplete)
    return s.paymentUrl
      ? { url: s.paymentUrl, label: 'Continue payment' }
      : null;
  if (!s.setupComplete)
    return s.setupUrl
      ? { url: s.setupUrl, label: 'Complete repayment setup' }
      : null;
  return null;
}
export function oxygenPrebookingStep(
  snapshot: OxygenRuntimeSnapshot
): 'phone' | 'verification' | 'eligibility' | null {
  if (!['eligibility_required', 'kyc_required'].includes(snapshot.stage))
    return null;
  const s = snapshot.state;
  if (!s.validated) return 'phone';
  const prerequisites = ['phone_status', 'bvn_status', 'selfie_status'].every(
    (key) =>
      s.kyc?.[key as 'phone_status' | 'bvn_status' | 'selfie_status'] === 'DONE'
  );
  if (prerequisites && !s.eligible) return 'eligibility';
  return 'verification';
}

export function oxygenSavedApprovalOffersMissing(
  snapshot: OxygenRuntimeSnapshot
) {
  const { state } = snapshot;
  return (
    snapshot.stage === 'approval_required' &&
    state.booking?.status === 'BOOKED' &&
    !state.offers?.some((offer) => offer.tenure === state.booking?.loan_tenure)
  );
}

export function canRefreshOxygenSavedApprovalOffers(
  snapshot: OxygenRuntimeSnapshot
) {
  const { state } = snapshot;
  return Boolean(
    state.applicationReference &&
      oxygenEligibilityPrerequisites(state) &&
      !state.paymentComplete &&
      !state.setupComplete
  );
}
