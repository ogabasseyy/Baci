import { normalizeStreetAddressForComparison } from '@/lib/normalize-street-address';

export function clearGeocodedFields<T extends object>(previous: T): T {
  return {
    ...previous,
    city: '',
    state: '',
    country: '',
    countryCode: '',
    postalCode: '',
    latitude: undefined,
    longitude: undefined,
  };
}

export function isFormattingOnlyStreetEdit(
  previous: string,
  next: string
): boolean {
  return (
    normalizeStreetAddressForComparison(previous) ===
    normalizeStreetAddressForComparison(next)
  );
}
