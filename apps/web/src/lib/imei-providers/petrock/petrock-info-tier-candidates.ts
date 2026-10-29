import { findPetrockCheckMapping } from './petrock-check-catalog';
import 'server-only';

import type { PETROCK_DARK_IMEI_SERVICE_TIERS } from '@baci/shared/imei';

type PetrockDarkTierKey = (typeof PETROCK_DARK_IMEI_SERVICE_TIERS)[number];

interface PetrockInfoTierCandidate {
  costUsdBaseline: number | null;
  /** False until a captured replay covers the shared tier's checksIncluded. */
  fixtureVerified: false;
  /** Null means catalog sync must confirm the byte-exact field before binding. */
  orderFieldName: string | null;
  productId: string | null;
  unavailableReason: string | null;
}

function candidate(productId: string): PetrockInfoTierCandidate {
  const mapping = findPetrockCheckMapping(productId);
  if (!mapping) throw new Error('Unmapped Petrock check candidate');
  return {
    costUsdBaseline: mapping.costUsd,
    fixtureVerified: false,
    orderFieldName: mapping.orderFieldName,
    productId,
    unavailableReason: null,
  };
}

function unavailableCandidate(reason: string): PetrockInfoTierCandidate {
  return {
    productId: null,
    costUsdBaseline: null,
    fixtureVerified: false,
    orderFieldName: null,
    unavailableReason: reason,
  };
}

/**
 * Server-only curation queue. Entries do not participate in provider routing
 * until fixtureVerified is replaced by a reviewed active tier binding.
 */
export const PETROCK_INFO_TIER_CANDIDATES = {
  esimCompatibility: candidate('1941'),
  refurbishedStatus: unavailableCandidate(
    'No current refurbished-only product'
  ),
  replacementStatus: candidate('1966'),
  applePartNumber: candidate('1963'),
  attFinance: candidate('1957'),
  tmobileFinance: candidate('746'),
  verizonFinance: candidate('1959'),
  knoxEnrollment: unavailableCandidate(
    'Product 700 is Knox Guard enrollment, not verified Knox Mobile Enrollment or MDM'
  ),
  samsungSoldBy: unavailableCandidate(
    'Product 1990 advertises sales country/date, not the original seller business'
  ),
  oneplusPremium: candidate('738'),
  transsionPremium: candidate('728'),
  // Current catalog uses IMEI as the machine key even for a Mac serial input.
  macInfo: candidate('698'),
  macPhotoReport: unavailableCandidate(
    'Product 713 is Find My Mac, not a photo report'
  ),
  applePremium: candidate('666'),
  applePremiumMax: candidate('1943'),
  tracfoneFinance: candidate('743'),
  xfinityFinance: unavailableCandidate(
    'Product 2015 checks unlock eligibility, not a verified finance-balance field'
  ),
  japanDocomo: candidate('732'),
  japanSoftbank: candidate('733'),
  japanKddi: candidate('730'),
  japanRakuten: unavailableCandidate('No verified Rakuten product'),
  japanNetwork: unavailableCandidate(
    'No verified generic Japan network product'
  ),
} as const satisfies Record<PetrockDarkTierKey, PetrockInfoTierCandidate>;
