import { isVerifiedGiglProviderRateId } from './is-verified-gigl-provider-rate-id';
import { matchesGiglProviderRate } from './matches-gigl-provider-rate';
import type { ShippingQuote } from './types';

type RecoveryQuotePreference = {
  service_tier: string | null;
  carrier_name: string | null;
  provider_rate_id: string | null;
} | null;

function tier(value: string | null): string {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized === 'standard' ? 'gostandard' : normalized;
}

function carrier(value: string | null): string {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  return normalized === 'gigl' || normalized === 'gig logistics'
    ? 'gigl'
    : normalized;
}

/** Preserve purchased service: accept known labels or verified stable GIGL
 * rate identity, never an arbitrary selector fallback to a different tier.
 * Provider/currency/address-delivery eligibility is enforced by the caller. */
export function matchesCheckoutRecoveryQuotePreference(
  quote: ShippingQuote,
  preference: RecoveryQuotePreference
): boolean {
  if (!preference) return true;
  const rateId = preference.provider_rate_id?.trim();
  if (
    isVerifiedGiglProviderRateId(rateId) &&
    isVerifiedGiglProviderRateId(quote.providerRateId) &&
    matchesGiglProviderRate(rateId, quote.providerRateId)
  )
    return true;
  const serviceTier = tier(preference.service_tier);
  const carrierName = carrier(preference.carrier_name);
  if (serviceTier && tier(quote.serviceTier) !== serviceTier) return false;
  if (carrierName && carrier(quote.carrierName) !== carrierName) return false;
  // A rate-only preference with no matching identity cannot establish which
  // service was bought. Fail closed rather than choose the first quote.
  return !rateId || Boolean(serviceTier);
}
