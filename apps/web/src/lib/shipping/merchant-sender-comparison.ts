import type { ShippingAddress } from '@/lib/shipping/types';
import { normalizeGiglLocation } from './providers/gigl.location-normalizer';

function coordinatesDiffer(
  left: number | undefined,
  right: number | undefined
): boolean {
  if (left == null && right == null) return false;
  if (left == null || right == null) return true;
  return Math.abs(left - right) > 1e-6;
}

function canonicalCountry(address: ShippingAddress): string {
  const countryCode = address.countryCode.trim().toUpperCase();
  if (countryCode === 'NGA') return 'NG';
  if (countryCode) return countryCode;

  const country = address.country.trim().toLowerCase();
  return country === 'nigeria' ? 'NG' : country;
}

/**
 * Compares the origin fields that affect domestic carrier routing. GIGL and
 * checkout accept equivalent Abuja/FCT labels, so canonicalize those labels
 * before deciding that a saved quote needs a refresh.
 */
export function domesticSendersDiffer(
  stored: ShippingAddress,
  resolved: ShippingAddress
): boolean {
  return (
    canonicalCountry(stored) !== canonicalCountry(resolved) ||
    normalizeGiglLocation(stored.city) !==
      normalizeGiglLocation(resolved.city) ||
    normalizeGiglLocation(stored.state) !==
      normalizeGiglLocation(resolved.state) ||
    coordinatesDiffer(stored.latitude, resolved.latitude) ||
    coordinatesDiffer(stored.longitude, resolved.longitude)
  );
}
