import { checkoutRecoveryStreetAddress } from './checkout-recovery-street-address';

// Nigeria bounding box for pins without Places country metadata (manual pins
// carry no country code). Rejects foreign coordinates that would otherwise
// fall through to the domestic path.
const NIGERIA_RECOVERY_BBOX = {
  minLat: 3.9,
  maxLat: 13.9,
  minLng: 2.6,
  maxLng: 14.8,
};

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
 * plus a bounding box for manual pins without country metadata) and carries
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
  if (
    !country &&
    (receiver.latitude < NIGERIA_RECOVERY_BBOX.minLat ||
      receiver.latitude > NIGERIA_RECOVERY_BBOX.maxLat ||
      receiver.longitude < NIGERIA_RECOVERY_BBOX.minLng ||
      receiver.longitude > NIGERIA_RECOVERY_BBOX.maxLng)
  )
    return {
      error:
        'Manual pins must fall within Nigeria. Search for the address to attach its country.',
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
