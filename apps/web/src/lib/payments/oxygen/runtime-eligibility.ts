import 'server-only';
import type { OxygenEligibilityProgress } from '@baci/shared/oxygen';
import { oxygenEligibilityReportSchema } from '@/schemas/oxygen-eligibility-report';
import type {
  OxygenProviderContext,
  OxygenProviderState,
} from '@/schemas/oxygen-runtime';
import { OxygenLocalValidationError } from './local-validation-diagnostic';
import { toOxygenMinorUnits } from './money';
import type { OxygenProvider } from './provider';
import { requireValue } from './runtime-policy';

// Owner-confirmed Oxygen minimum in naira (2026-10-31); omitted fields only.
const OXYGEN_MINIMUM_LOAN_AMOUNT_NAIRA = 10_000;

function classifyProgress(
  message: string
): OxygenEligibilityProgress | undefined {
  const text = message.trim();
  if (
    /\b(?:reviewing|fetching|retrieving|checking|processing) your bank statement\b/i.test(
      text
    )
  )
    return 'bank_statement';
  if (/\b(?:retrieving|checking|fetching) your credit score\b/i.test(text))
    return 'credit_score';
  if (/\breviewing your eligibility\b/i.test(text)) return 'eligibility_review';
  return undefined;
}

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
  const progress =
    state.eligibilityStatus === 'pending'
      ? classifyProgress(response.message)
      : undefined;
  if (progress) state.eligibilityProgress = progress;
  else delete state.eligibilityProgress;
  // Match only the observed Oxygen prefix; unknown failures use the generic
  // message. Never retain the provider's raw message.
  if (
    response.status === 'FAILED' &&
    /^your\s+financial\s+details\s+do\s+not\s+match\b/i.test(
      response.message.trim()
    )
  ) {
    state.eligibilityFailureReason = 'financial_details_mismatch';
  } else {
    delete state.eligibilityFailureReason;
    if (response.status === 'FAILED')
      console.warn('oxygen_eligibility_failure_unclassified');
  }
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
    if (response.offers?.length) {
      if (response.tenure_unit?.toLowerCase() !== 'monthly') {
        throw new Error('Invalid eligibility offer period');
      }
      const seen = new Set<number>();
      for (const offer of response.offers) {
        try {
          toOxygenMinorUnits(offer.loan_amount, 'NGN');
        } catch {
          throw new Error('Invalid eligibility offers');
        }
        if (seen.has(offer.tenor) || offer.tenor > state.maxTenure) {
          throw new Error('Invalid eligibility offers');
        }
        seen.add(offer.tenor);
      }
      state.offers = response.offers.map((offer) => ({
        loanAmount: offer.loan_amount,
        tenure: offer.tenor,
      }));
    } else delete state.offers;
  } else {
    delete state.eligibleAmount;
    delete state.minimumAmount;
    delete state.maxTenure;
    delete state.offers;
  }
}
