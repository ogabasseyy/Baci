import { checkoutRecoveryStreetAddress } from './checkout-recovery-street-address';

// Coarse Nigeria border polygon as [longitude, latitude] pairs, slightly
// inset from the true boundary. A rectangular box cannot separate the border:
// Garoua, Cameroon (~9.3N 13.4E) falls inside any box covering Borno, so
// manual pins without Places country metadata are checked against the border
// itself. Caller-supplied country codes are not Places-verified server-side
// and never exempt the pin.
const NIGERIA_RECOVERY_POLYGON: ReadonlyArray<readonly [number, number]> = [
  [2.75, 6.3],
  [2.8, 6.7],
  [2.95, 7.4],
  [3.0, 8.1],
  [2.95, 8.9],
  [3.3, 9.6],
  [3.6, 10.4],
  [3.9, 11.2],
  [4.15, 11.9],
  [4.45, 12.4],
  [4.7, 13.0],
  [5.0, 13.35],
  [5.5, 13.55],
  [6.1, 13.65],
  [7.0, 13.65],
  [8.0, 13.65],
  [8.9, 13.45],
  [9.6, 13.35],
  [10.3, 13.25],
  [11.0, 13.2],
  [11.8, 13.15],
  [12.4, 13.0],
  [13.0, 12.85],
  [13.4, 12.5],
  [13.55, 12.0],
  [13.45, 11.4],
  [13.4, 10.8],
  [13.25, 10.2],
  [12.9, 9.7],
  [12.6, 9.35],
  [12.3, 9.0],
  [12.0, 8.6],
  [11.6, 8.2],
  [11.2, 7.8],
  [10.8, 7.4],
  [10.4, 7.0],
  [10.0, 6.7],
  [9.6, 6.4],
  [9.2, 6.1],
  [8.8, 5.9],
  [8.5, 5.6],
  [8.35, 5.2],
  [8.25, 4.8],
  [7.9, 4.55],
  [7.4, 4.45],
  [6.9, 4.5],
  [6.4, 4.6],
  [5.9, 4.8],
  [5.4, 5.0],
  [4.9, 5.3],
  [4.4, 5.6],
  [3.9, 5.9],
  [3.4, 6.1],
  [3.0, 6.25],
];

function isInsideNigeriaRecoveryPolygon(
  latitude: number,
  longitude: number
): boolean {
  let inside = false;
  for (
    let i = 0, j = NIGERIA_RECOVERY_POLYGON.length - 1;
    i < NIGERIA_RECOVERY_POLYGON.length;
    j = i++
  ) {
    const [xi, yi] = NIGERIA_RECOVERY_POLYGON[i];
    const [xj, yj] = NIGERIA_RECOVERY_POLYGON[j];
    if (
      yi > latitude !== yj > latitude &&
      longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

type RecoveryReceiverInput = {
  address: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  countryCode?: string;
};

/**
 * Resolves the caller-supplied recovery destination into the quote-request
 * receiver override. Enforces the Nigeria-only scope (explicit country codes
 * plus a border-polygon check for manual pins without country metadata) and carries
 * the legacy snake_case postal code forward, since the quote builder only
 * reads camelCase and the booking guard would otherwise see a postal code on
 * the retained order address but none on the saved quote.
 */
export function resolveRecoveryQuoteReceiver(
  receiver: RecoveryReceiverInput,
  shippingAddress: unknown
):
  | { override: RecoveryReceiverInput & { postalCode?: string } }
  | { error: string } {
  const country = receiver.countryCode?.trim().toUpperCase();
  if (country && country !== 'NG')
    return { error: 'This recovery supports Nigerian destinations only.' };
  // The pin must fall inside Nigeria however the country was claimed: an
  // explicit 'NG' code is caller-supplied and not Places-verified server-side,
  // so it cannot exempt foreign coordinates from the border check.
  if (!isInsideNigeriaRecoveryPolygon(receiver.latitude, receiver.longitude))
    return {
      error:
        'Destination pins must fall within Nigeria. Search for the address to attach its country.',
    };
  const storedAddress =
    shippingAddress && typeof shippingAddress === 'object'
      ? (shippingAddress as { postal_code?: unknown; postalCode?: unknown })
      : null;
  const legacyPostalCode =
    typeof storedAddress?.postal_code === 'string' &&
    storedAddress.postal_code.trim()
      ? storedAddress.postal_code.trim()
      : typeof storedAddress?.postalCode === 'string' &&
          storedAddress.postalCode.trim()
        ? storedAddress.postalCode.trim()
        : undefined;
  return {
    override: {
      ...receiver,
      address: checkoutRecoveryStreetAddress(
        receiver.address,
        receiver.city,
        receiver.state
      ),
      ...(legacyPostalCode ? { postalCode: legacyPostalCode } : {}),
    },
  };
}
