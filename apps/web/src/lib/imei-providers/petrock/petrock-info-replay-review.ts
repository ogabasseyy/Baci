import 'server-only';

import {
  IMEI_SERVICE_TIERS,
  type PETROCK_DARK_IMEI_SERVICE_TIERS,
} from '@baci/shared/imei';
import { PETROCK_INFO_TIER_CANDIDATES } from './petrock-info-tier-candidates';
import { parsePetrockReplay } from './petrock-parser';

type CandidateKey = (typeof PETROCK_DARK_IMEI_SERVICE_TIERS)[number];

/** Offline inspection only. Supplying a replay cannot approve a binding, prove
 * capture provenance, or establish other device/identifier scopes. No network IO.
 */
export function inspectPetrockInfoCandidateReplay(
  tierKey: CandidateKey,
  capture: { productId: string; status: string; replay: string }
) {
  const candidate = PETROCK_INFO_TIER_CANDIDATES[tierKey];
  const checks = IMEI_SERVICE_TIERS[tierKey].checksIncluded;
  const blockers: string[] = ['reviewed_capture_required'];
  if (!candidate.productId) blockers.push('no_matching_product');
  if (capture.productId !== candidate.productId) {
    blockers.push('product_mismatch');
  }
  if (capture.status !== 'success') blockers.push('completion_required');

  // Do not credit fields from the wrong service or a nonterminal/rejected order.
  const eligible = blockers.length === 1;
  const parsed = eligible ? parsePetrockReplay(capture.replay) : {};
  const missingFields = checks.filter((field) => {
    const value = parsed[field];
    return (
      typeof value !== 'string' ||
      !value.trim() ||
      /^(?:unknown|n\/?a|not (?:available|found)|unavailable|unknown device)$/i.test(
        value.trim()
      )
    );
  });
  if (missingFields.length) blockers.push('promised_fields_missing');

  return {
    tierKey,
    productId: candidate.productId,
    missingFields,
    blockers,
    // A synthetic replay passing parser checks must never become launch evidence.
    fixtureVerified: candidate.fixtureVerified,
  };
}
