import { getLegacyAirportType } from '@/lib/checkout/airport-delivery-legacy-marker';
import { LocalAirportDeliveryValidationError } from '@/lib/checkout/local-airport-delivery-validation-error';

interface AirportDeliveryAddress {
  address?: string | null;
  city?: string | null;
  state?: string | null;
}

interface ValidateAirportDeliveryAddressInput {
  airportType?: 'delivery' | 'pickup';
  deliveryMethod?: string;
  selectedQuoteId?: string | null;
  shippingAddress?: AirportDeliveryAddress | null;
  shippingRateId?: string | null;
}

export function validateAirportDeliveryAddress({
  airportType,
  deliveryMethod,
  selectedQuoteId,
  shippingAddress,
  shippingRateId,
}: ValidateAirportDeliveryAddressInput): void {
  const normalizedCity = shippingAddress?.city?.trim().toLowerCase();
  const normalizedState = shippingAddress?.state?.trim().toLowerCase();
  const hasSyntheticDestination =
    normalizedCity === 'airport' && normalizedState === 'nigeria';
  const hasLegacyMarkerAddress =
    getLegacyAirportType(shippingAddress?.address) !== null;
  const hasConcretePickupLocation = Boolean(
    shippingAddress?.city?.trim() &&
      shippingAddress?.state?.trim() &&
      !(normalizedCity === 'airport' && normalizedState === 'nigeria')
  );
  const hasConcreteDeliveryAddress = Boolean(
    shippingAddress?.address?.trim() &&
      shippingAddress.city?.trim() &&
      shippingAddress.state?.trim() &&
      !hasSyntheticDestination &&
      !hasLegacyMarkerAddress
  );

  // A provider quote only verifies the transport price. It does not supply a
  // customer destination, so quoted airport delivery still needs a concrete
  // street address before the order can be created.
  if (
    deliveryMethod === 'airport' &&
    airportType === 'delivery' &&
    selectedQuoteId &&
    !hasConcreteDeliveryAddress
  ) {
    throw new LocalAirportDeliveryValidationError(
      'A delivery address is required for local airport delivery',
      'AIRPORT_ADDRESS_REQUIRED',
      400
    );
  }

  if (
    deliveryMethod === 'airport' &&
    airportType === 'pickup' &&
    !selectedQuoteId &&
    !shippingRateId &&
    !hasConcretePickupLocation
  ) {
    throw new LocalAirportDeliveryValidationError(
      'An airport pickup location is required',
      'AIRPORT_PICKUP_LOCATION_REQUIRED',
      400
    );
  }

  if (
    deliveryMethod !== 'airport' ||
    airportType !== 'delivery' ||
    shippingRateId ||
    hasConcreteDeliveryAddress
  ) {
    return;
  }

  throw new LocalAirportDeliveryValidationError(
    'A delivery address is required for local airport delivery',
    'AIRPORT_ADDRESS_REQUIRED',
    400
  );
}
