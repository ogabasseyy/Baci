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

// Recognized legacy IDs omit centre/delivery/sender suffixes; current IDs
// include them. Reject malformed enum values before the shared permissive
// parser can default them to standard delivery and manufacture a match.
function verifiedRateId(value: string | undefined): value is string {
  return Boolean(
    value &&
      /^GIGL_[1-9]\d*_[01]_[0-3](?:_(?:0|[1-9]\d*)(?:_[01](?:_[1-9]\d*)?)?)?$/.test(
        value
      ) &&
      value
        .split('_')
        .slice(1)
        .every((part) => Number.isSafeInteger(Number(part)))
  );
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
    verifiedRateId(rateId) &&
    verifiedRateId(quote.providerRateId) &&
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
