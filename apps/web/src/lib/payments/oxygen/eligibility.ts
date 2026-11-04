import {
  oxygenAffirmativeEligibilitySchema,
  oxygenPendingEligibilitySchema,
} from '@/schemas/oxygen-eligibility';

/**
 * Fail-closed classification of Oxygen eligibility lookup responses.
 *
 * Only the two shapes documented in the provider GitBook (CR-05) yield a
 * non-unknown outcome. Everything else — other errors, explicit-looking
 * declines, contradictory or malformed payloads — is `unknown`: automatic
 * progression must stop and reconcile, never approve or decline.
 */
export type OxygenEligibilityClassification =
  | { kind: 'eligible'; eligibleAmount: number }
  | { kind: 'pending' }
  | { kind: 'unknown' };

export function classifyOxygenEligibility(
  body: unknown
): OxygenEligibilityClassification {
  const affirmative = oxygenAffirmativeEligibilitySchema.safeParse(body);
  if (affirmative.success) {
    const amount = affirmative.data.eligible_amount;
    if (Number.isFinite(amount) && amount > 0) {
      return { kind: 'eligible', eligibleAmount: amount };
    }
    return { kind: 'unknown' };
  }

  if (oxygenPendingEligibilitySchema.safeParse(body).success) {
    return { kind: 'pending' };
  }

  return { kind: 'unknown' };
}
