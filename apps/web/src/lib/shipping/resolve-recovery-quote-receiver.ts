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
 * plus a versioned national boundary check for all pins). A stored postcode
 * can accompany only a verified unchanged street/city/state. Explicitly clear
 * it otherwise so the quote builder cannot inherit stale camelCase metadata.
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
      ? (shippingAddress as Record<string, unknown>)
      : null;
  const legacyPostalCode =
    typeof storedAddress?.postal_code === 'string' &&
    storedAddress.postal_code.trim()
      ? storedAddress.postal_code.trim()
      : typeof storedAddress?.postalCode === 'string' &&
          storedAddress.postalCode.trim()
        ? storedAddress.postalCode.trim()
        : undefined;
  const text = (value: unknown) =>
    typeof value === 'string' ? value.trim() : '';
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .split(',')
      .map((part) => part.trim())
      .join(',');
  const city = text(storedAddress?.city);
  const state = text(storedAddress?.state);
  const oldStreet = checkoutRecoveryStreetAddress(
    text(storedAddress?.address) || text(storedAddress?.address_line1),
    city,
    state
  );
  const unit = text(storedAddress?.address_line2);
  // Require the full original street including an independently stored unit.
  // Ambiguous legacy representations lose their postcode rather than guessing.
  const unitWords = normalize(unit).replace(/,/g, ' ');
  const unitIncluded = /^\d+$/.test(unitWords)
    ? oldStreet
        .split(/[,\n\r]/)
        .some((part) => normalize(part) === normalize(unit))
    : ` ${normalize(oldStreet).replace(/,/g, ' ')} `.includes(` ${unitWords} `);
  const oldFullStreet =
    unit && !unitIncluded ? `${oldStreet}, ${unit}` : oldStreet;
  const street = checkoutRecoveryStreetAddress(
    receiver.address,
    receiver.city,
    receiver.state
  );
  const unchanged =
    Boolean(oldStreet && city && state) &&
    normalize(oldFullStreet) === normalize(street) &&
    normalize(city) === normalize(receiver.city) &&
    normalize(state) === normalize(receiver.state) &&
    (!text(storedAddress?.countryCode) ||
      text(storedAddress?.countryCode).toUpperCase() === 'NG') &&
    (!text(storedAddress?.country) ||
      text(storedAddress?.country).toLowerCase() === 'nigeria');
  return {
    override: {
      ...receiver,
      country: 'Nigeria',
      countryCode: 'NG',
      address: street,
      // Undefined must be present: omission lets the builder inherit the old
      // order's camelCase postcode before the signed quote is serialized.
      postalCode: unchanged ? legacyPostalCode : undefined,
    },
  };
}
