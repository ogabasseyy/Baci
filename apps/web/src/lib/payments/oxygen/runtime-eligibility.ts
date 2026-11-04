import 'server-only';
import { oxygenEligibilityReportSchema } from '@/schemas/oxygen-eligibility-report';
import type {
  OxygenProviderContext,
  OxygenProviderState,
} from '@/schemas/oxygen-runtime';
import { OxygenLocalValidationError } from './local-validation-diagnostic';
import type { OxygenProvider } from './provider';
import { requireValue } from './runtime-policy';

// Owner-confirmed Oxygen minimum in naira (2026-10-31); omitted fields only.
const OXYGEN_MINIMUM_LOAN_AMOUNT_NAIRA = 10_000;

export async function refreshOxygenEligibility(
  context: OxygenProviderContext,
  state: OxygenProviderState,
  provider: OxygenProvider
) {
  const response = oxygenEligibilityReportSchema.parse(
    await provider.call('eligibility', {
      loan_request_reference: requireValue(state.applicationReference),
      partner_reference: context.partnerReference,
    })
  );
  const mismatches: ('loan_request_reference' | 'partner_reference')[] = [];
  if (response.loan_request_reference !== state.applicationReference)
    mismatches.push('loan_request_reference');
  if (response.partner_reference !== context.partnerReference)
    mismatches.push('partner_reference');
  if (mismatches.length)
    throw new OxygenLocalValidationError('reference_mismatch', mismatches);
  state.eligibilityStatus =
    response.status === 'COMPLETED'
      ? 'completed'
      : response.status === 'FAILED'
        ? 'failed'
        : 'pending';
  if (response.status === 'COMPLETED') state.eligible = response.is_eligible;
  else delete state.eligible;
  if (state.eligible) {
    const missing = (
      ['eligible_amount', 'max_loan_amount', 'max_tenure'] as const
    ).filter((field) => response[field] === undefined);
    if (missing.length)
      throw new OxygenLocalValidationError('required_field_missing', missing);
    state.eligibleAmount = Math.min(
      requireValue(response.eligible_amount),
      requireValue(response.max_loan_amount)
    );
    state.minimumAmount =
      response.minimum_loan_amount ?? OXYGEN_MINIMUM_LOAN_AMOUNT_NAIRA;
    state.maxTenure = requireValue(response.max_tenure);
  } else {
    delete state.eligibleAmount;
    delete state.minimumAmount;
    delete state.maxTenure;
  }
}
