import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import type { OxygenJourneyStage } from './journey-events';

/** Customer-facing funnel steps, rather than treating all pre-booking work as OTP/eligibility. */
export function oxygenCustomerStep(
  snapshot: OxygenRuntimeSnapshot,
  addressSubmitted = false
): OxygenJourneyStage {
  const { stage, state } = snapshot;
  if (stage === 'application_required') return 'identity';
  if (stage === 'eligibility_required' || stage === 'kyc_required') {
    if (!state.validated) return 'phone';
    if (state.selfieUrl && state.kyc?.selfie_status !== 'DONE') return 'selfie';
    if (
      !state.kyc ||
      (
        [
          'bvn_status',
          'nin_status',
          'bank_status',
          'phone_status',
          'selfie_status',
        ] as const
      ).some((key) => state.kyc?.[key] !== 'DONE')
    )
      return 'verification';
    return 'eligibility';
  }
  if (stage === 'booked')
    return addressSubmitted || state.kyc?.address_status === 'PROCESSING'
      ? 'address_review'
      : 'address';
  if (stage === 'approval_required') return 'offer';
  if (stage === 'payment_required')
    return state.paymentComplete ? 'repayment_setup' : 'upfront_payment';
  return stage;
}
