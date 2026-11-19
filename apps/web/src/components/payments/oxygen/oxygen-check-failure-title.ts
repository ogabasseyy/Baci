import type { OxygenRuntimeAction } from '@/schemas/oxygen-runtime';
/** Identify the failed operation without leaking private provider diagnostics. */
export function oxygenCheckFailureTitle(
  action?: OxygenRuntimeAction['action'] | null
) {
  switch (action) {
    case 'submit_address':
      return 'We couldn’t confirm your home address';
    case 'validate_nin':
      return 'We couldn’t complete your NIN check';
    case 'refresh_eligibility':
      return 'Oxygen couldn’t complete the eligibility check';
    case 'refresh_details':
      return 'We couldn’t load your payment breakdown';
    default:
      return 'We couldn’t complete this check';
  }
}
