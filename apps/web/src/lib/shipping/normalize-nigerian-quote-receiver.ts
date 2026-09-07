import { resolveLocationStateLabel } from '@baci/shared/lib';
import { NIGERIAN_STATES_FALLBACK } from '@/app/api/shipping/locations/fallback-locations';

interface QuoteReceiverLocation {
  address: string;
  country?: string;
  countryCode?: string;
  state?: string;
}

function findKnownState(value: string): string | null {
  const candidate = value
    .replace(/\b\d{5,6}\b/g, '')
    .replace(/\s+state\s*$/i, '')
    .trim();
  if (!candidate) return null;

  const resolved = resolveLocationStateLabel(
    candidate,
    NIGERIAN_STATES_FALLBACK
  );
  return NIGERIAN_STATES_FALLBACK.includes(resolved) ? resolved : null;
}

export function normalizeNigerianQuoteReceiver<T extends QuoteReceiverLocation>(
  receiver: T,
  shipmentType: 'domestic' | 'international'
): T {
  if (shipmentType === 'international') return receiver;

  const countryCode = receiver.countryCode?.trim().toUpperCase();
  const country = receiver.country?.trim().toLowerCase();
  if (
    (countryCode && countryCode !== 'NG') ||
    (!countryCode && country && country !== 'nigeria')
  ) {
    return receiver;
  }

  // Persist explicit Nigeria defaults so blank domestic Admin quote payloads
  // do not later fail receiver attestation against omitted/blank order fields.
  const withDomesticCountry: T = {
    ...receiver,
    country: country ? receiver.country?.trim() || 'Nigeria' : 'Nigeria',
    countryCode: countryCode || 'NG',
  };

  const canonicalState =
    findKnownState(withDomesticCountry.state ?? '') ??
    [...(withDomesticCountry.address ?? '').split(',')]
      .reverse()
      .map(findKnownState)
      .find((state): state is string => state !== null);

  if (!canonicalState || canonicalState === withDomesticCountry.state) {
    return withDomesticCountry;
  }
  return { ...withDomesticCountry, state: canonicalState };
}
