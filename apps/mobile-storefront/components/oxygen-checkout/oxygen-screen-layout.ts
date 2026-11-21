import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import {
  oxygenPrebookingStep,
  oxygenSelfieRequired,
} from './oxygen-checkout-presentation';

export function oxygenShowsInlineRecovery(
  snapshot: OxygenRuntimeSnapshot | null | undefined
): boolean {
  return Boolean(
    snapshot &&
      !oxygenSelfieRequired(snapshot) &&
      ![
        'application_required',
        'approval_required',
        'activated',
        'plan_required',
        'booked',
        'payment_required',
        'ready_for_activation',
      ].includes(snapshot.stage) &&
      !(snapshot.stage === 'reconciliation_required' && snapshot.pending) &&
      !['eligibility', 'verification'].includes(
        oxygenPrebookingStep(snapshot) ?? ''
      )
  );
}
