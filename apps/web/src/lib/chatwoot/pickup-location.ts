const MAX_PICKUP_LOCATION_LENGTH = 240;

/**
 * The pickup location text shown for a station-pickup rate: station name and
 * address joined with ' · ', trimmed and cut to 240 characters. Shared by the
 * delivery-options projection (server) and the in-chat checkout matcher
 * (browser) so both derive the identical string; it must stay pure.
 */
export function formatChatwootPickupLocation(quote: {
  isStationPickup?: boolean;
  stationName?: unknown;
  stationAddress?: unknown;
}): string | undefined {
  if (!quote.isStationPickup) return undefined;
  const location = [quote.stationName, quote.stationAddress]
    .filter((part): part is string => typeof part === 'string')
    .join(' · ')
    .trim()
    .slice(0, MAX_PICKUP_LOCATION_LENGTH);
  return location || undefined;
}
