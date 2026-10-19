import type { ShippingQuote } from './types';
import { isMerchantQuote } from './is-merchant-quote';

/** Provider-aware copy for the shared station-pickup surfaces. */
export interface PickupStationCopy {
  /** Delivery-method tab label. */
  methodLabel: string;
  /** Delivery-method tab subtitle. */
  methodSubtitle: string;
  /** Heading shown in the selected-pickup detail card. */
  detailHeading: string;
  /** Fallback body when the quote carries no address text. */
  detailFallback: string;
  /** Title on the door-unavailable pickup affordance. */
  doorUnavailableTitle: string;
  /** Body on the door-unavailable pickup affordance. */
  doorUnavailableBody: string;
  /** CTA on the door-unavailable pickup affordance. */
  chooseButtonLabel: string;
}

const GIGL_PICKUP_STATION_COPY: PickupStationCopy = {
  methodLabel: 'Pickup Stations (GIGL)',
  methodSubtitle: 'Collect at service centre',
  detailHeading: 'Pickup Stations (GIGL)',
  detailFallback: 'Collect from the selected GIGL service centre.',
  doorUnavailableTitle:
    "GIGL doesn't currently support door delivery to this location.",
  doorUnavailableBody:
    'Choose Pickup Stations (GIGL) to collect from a nearby service centre.',
  chooseButtonLabel: 'Choose Pickup Stations (GIGL)',
};

const MERCHANT_PICKUP_STATION_COPY: PickupStationCopy = {
  methodLabel: 'Store Pickup',
  methodSubtitle: 'Collect in person',
  detailHeading: 'Store Pickup',
  detailFallback: 'Collect your order from the store.',
  doorUnavailableTitle: 'Pick up your order in person.',
  doorUnavailableBody: 'Collect your order from the pickup location below.',
  chooseButtonLabel: 'Choose Store Pickup',
};

/**
 * Provider-aware copy for the station-pickup surfaces. Merchant `pickup` rates
 * reuse the existing station-pickup delivery path (they set
 * `isStationPickup: true`), so the only difference is neutral, non-GIGL wording.
 */
export function getPickupStationCopy(
  quote: ShippingQuote | undefined,
): PickupStationCopy {
  return quote && isMerchantQuote(quote)
    ? MERCHANT_PICKUP_STATION_COPY
    : GIGL_PICKUP_STATION_COPY;
}
