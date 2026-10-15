import { checkoutRecoveryStreetAddress } from './checkout-recovery-street-address';

import { isNigeriaRecoveryPin } from './is-nigeria-recovery-pin';

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
 * plus a versioned national boundary check for all pins) and carries
 * the legacy snake_case postal code forward, since the quote builder only
 * reads camelCase and the booking guard would otherwise see a postal code on
 * the retained order address but none on the saved quote.
 */
export function resolveRecoveryQuoteReceiver(
  receiver: RecoveryReceiverInput,
  shippingAddress: unknown
):
  | {
      override: RecoveryReceiverInput & {
        country: string;
        postalCode?: string;
      };
    }
  | { error: string } {
  const country = receiver.countryCode?.trim().toUpperCase();
  if (country && country !== 'NG')
    return { error: 'This recovery supports Nigerian destinations only.' };
  // The pin must fall inside Nigeria however the country was claimed: an
  // explicit 'NG' code is caller-supplied and not Places-verified server-side,
  // so it cannot exempt foreign coordinates from the border check.
  if (!isNigeriaRecoveryPin(receiver.latitude, receiver.longitude))
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
      country: 'Nigeria',
      countryCode: 'NG',
      address: checkoutRecoveryStreetAddress(
        receiver.address,
        receiver.city,
        receiver.state
      ),
      ...(legacyPostalCode ? { postalCode: legacyPostalCode } : {}),
    },
  };
}
