import { MERCHANT_RATE_ID_PREFIX } from '@/lib/shipping/merchant-rates/to-shipping-quotes';
import { MERCHANT_PROVIDER_CODE } from '@/lib/shipping/types';
import type { DeliveryMethod, ShippingQuote } from './types';
import { isGiglGoFasterQuote } from './is-gigl-go-faster-quote';
import { isStationPickupQuote } from './is-station-pickup-quote';

export function getDoorDeliveryQuotes(
  quotes: ShippingQuote[],
): ShippingQuote[] {
  return quotes.filter(
    (quote) =>
      !isStationPickupQuote(quote) && !isGiglGoFasterQuote(quote),
  );
}

export function getAirDeliveryQuotes(
  quotes: ShippingQuote[],
): ShippingQuote[] {
  return quotes.filter(isGiglGoFasterQuote);
}

export function getStationPickupQuote(
  quotes: ShippingQuote[],
): ShippingQuote | undefined {
  return quotes.find(isStationPickupQuote);
}

/**
 * All station-pickup quotes (carrier stations AND merchant pickup rates), in
 * quote order. A merchant can configure several pickup locations in one zone;
 * each surfaces as its own station-pickup quote with a distinct `mrate_<uuid>`
 * id, so the checkout must be able to list and select every one of them rather
 * than collapsing to the first via `getStationPickupQuote`.
 */
export function getStationPickupQuotes(
  quotes: ShippingQuote[],
): ShippingQuote[] {
  return quotes.filter(isStationPickupQuote);
}

export function getPreferredDoorQuoteId(quotes: ShippingQuote[]): string {
  return getDoorDeliveryQuotes(quotes)[0]?.id ?? '';
}

export function getSelectedQuoteIdForDeliveryMethod(
  deliveryMethod: DeliveryMethod,
  selectedQuoteId: string,
  shippingQuotes: ShippingQuote[],
): string {
  if (deliveryMethod === 'pickup_station') {
    // Preserve an already-selected pickup quote so a shopper who picks the
    // second of several merchant pickup locations, leaves the tab, and returns
    // isn't silently reset to the first one.
    const selectedQuote = shippingQuotes.find(
      (quote) => String(quote.id) === String(selectedQuoteId),
    );
    return selectedQuote && isStationPickupQuote(selectedQuote)
      ? selectedQuoteId
      : (getStationPickupQuote(shippingQuotes)?.id ?? selectedQuoteId);
  }

  if (deliveryMethod === 'door') {
    const selectedQuote = shippingQuotes.find(
      (quote) => String(quote.id) === String(selectedQuoteId),
    );
    return selectedQuote &&
      !isStationPickupQuote(selectedQuote) &&
      !isGiglGoFasterQuote(selectedQuote)
      ? selectedQuoteId
      : getPreferredDoorQuoteId(shippingQuotes);
  }

  if (deliveryMethod === 'airport') {
    const selectedQuote = shippingQuotes.find(
      (quote) => String(quote.id) === String(selectedQuoteId),
    );
    return isGiglGoFasterQuote(selectedQuote) ? selectedQuoteId : '';
  }

  return selectedQuoteId;
}

export function createSelectDeliveryMethod({
  selectedQuoteId,
  setDeliveryMethod,
  setSelectedQuoteId,
  shippingQuotes,
}: {
  selectedQuoteId: string;
  setDeliveryMethod: (method: DeliveryMethod) => void;
  setSelectedQuoteId: (quoteId: string) => void;
  shippingQuotes: ShippingQuote[];
}) {
  return (method: DeliveryMethod) => {
    setSelectedQuoteId(
      getSelectedQuoteIdForDeliveryMethod(
        method,
        selectedQuoteId,
        shippingQuotes,
      ),
    );
    setDeliveryMethod(method);
  };
}

export function resetDeliveryQuotesForAddressChange({
  setDeliveryMethod,
  setSelectedQuoteId,
  setShippingQuotes,
  clearDeliveryCoordinates,
}: {
  setDeliveryMethod: (method: DeliveryMethod) => void;
  setSelectedQuoteId: (quoteId: string) => void;
  setShippingQuotes: (quotes: ShippingQuote[]) => void;
  clearDeliveryCoordinates?: () => void;
}) {
  clearDeliveryCoordinates?.();
  setShippingQuotes([]);
  setSelectedQuoteId('');
  setDeliveryMethod('door');
}

export function getStationPickupAddressText(quote: ShippingQuote): string {
  return [quote.stationName, quote.stationAddress]
    .filter((line): line is string => Boolean(line))
    .join(', ');
}

/**
 * Merchant-configured rate quotes surface with `provider === 'MERCHANT'` and a
 * `mrate_<uuid>` id. These helpers let the checkout UI treat them
 * provider-agnostically while the order POST recovers the bare rate id.
 */
export function isMerchantQuote(quote: ShippingQuote): boolean {
  return quote.provider === MERCHANT_PROVIDER_CODE;
}

/**
 * Extract the bare `merchant_shipping_rates.id` from a selected quote id, or
 * `null` when the selection is a carrier quote. The order POST sends this as
 * `shipping_rate_id` (and forces the null shipping_provider/selected_quote_id
 * path) so the server recomputes the fee from rate config.
 */
export function getMerchantRateId(quoteId: string): string | null {
  return quoteId.startsWith(MERCHANT_RATE_ID_PREFIX)
    ? quoteId.slice(MERCHANT_RATE_ID_PREFIX.length) || null
    : null;
}

/**
 * The quote id safe to forward to the order-create and order-reuse APIs as
 * `selected_quote_id`.
 *
 * Returns `undefined` (i.e. "send nothing") when:
 *   - the method has no third-party quote (pickup/airport), or
 *   - the selection is a merchant rate. Merchant rates carry a synthetic
 *     `mrate_<uuid>` id that is NOT a persisted quote row — the server
 *     recomputes their fee from `shipping_rate_id` instead. Both the reuse
 *     route (`z.uuid()` on `selected_quote_id`) and the order-create RPC reject
 *     the synthetic id, so it must never be forwarded. The reuse route reopens
 *     an already-fee-verified pending order and does not re-verify shipping, so
 *     omitting it is safe.
 */
export function getForwardableSelectedQuoteId(
  deliveryMethod: DeliveryMethod,
  selectedQuoteId: string,
): string | undefined {
  if (deliveryMethod !== 'door' && deliveryMethod !== 'pickup_station') {
    return undefined;
  }
  if (getMerchantRateId(selectedQuoteId)) {
    return undefined;
  }
  return selectedQuoteId || undefined;
}

/**
 * Delivery-estimate line for a quote, or `null` when it should be omitted.
 * Merchant rates without configured days carry `estimatedDays === 0` (an
 * "unknown estimate" sentinel) — callers must not render "0 days".
 */
export function getDeliveryEstimateLabel(quote: ShippingQuote): string | null {
  if (quote.deliveryRange) return quote.deliveryRange;
  if (quote.estimatedDays > 0) return `${quote.estimatedDays} days`;
  return null;
}

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

