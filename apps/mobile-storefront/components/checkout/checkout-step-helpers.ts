import { AIRPORT_DELIVERY_FEES } from '@baci/shared/constants';
import {
  getPickupStationAddressText,
  getPickupStationLabel,
  isProviderStationPickupQuote,
} from '@/components/checkout/checkout-station-pickup';
import type {
  PaymentMethodType,
  PaymentTab,
} from '@/components/checkout/PaymentMethodSelector';
import type {
  DeliveryMethod,
  ShippingQuote,
  ShippingQuoteDeliveryPreference,
} from '@/components/checkout/types';

export const AIRPORT_DELIVERY_FEE = AIRPORT_DELIVERY_FEES.delivery;
export const AIRPORT_QUOTE_ID = 'airport-delivery';
export const AIRPORT_DELIVERY_ESTIMATE = 'Within 1–48 hours';
export const LAGOS_ROAD_DELIVERY_ESTIMATE = 'Within 1–24 hours';
export const MERCHANT_OFFICE_PICKUP_LABEL = 'Merchant office pickup';
const DEFAULT_CARRIER = 'Topship';

export function getPaymentTabForMethod(method: PaymentMethodType): PaymentTab {
  if (
    method === 'credpal' ||
    method === 'credit_direct' ||
    method === 'klump'
  ) {
    return 'installments';
  }

  if (method === 'invoice' || method === 'payforme') {
    return 'pay_later';
  }

  return 'full';
}

export function getDeliveryMethodFee(
  deliveryMethod: DeliveryMethod,
  selectedQuote: ShippingQuote | undefined
): number {
  if (deliveryMethod === 'airport') {
    return selectedQuote && isGiglGoFasterQuote(selectedQuote)
      ? selectedQuote.price
      : AIRPORT_DELIVERY_FEE;
  }
  if (deliveryMethod === 'pickup_station') {
    return isProviderStationPickupQuote(selectedQuote)
      ? selectedQuote.price
      : 0;
  }
  return isRoadDeliveryQuote(selectedQuote) ? selectedQuote.price : 0;
}

export function getQuotePreference(
  deliveryMethod: DeliveryMethod
): ShippingQuoteDeliveryPreference {
  return deliveryMethod === 'pickup_station' ? 'pickup_station' : 'door';
}

export function getDeliveryMethodLabel(
  deliveryMethod: DeliveryMethod,
  selectedQuote?: ShippingQuote
): string {
  switch (deliveryMethod) {
    case 'airport':
      return 'Airport Delivery';
    case 'pickup_station':
      return getPickupStationLabel(selectedQuote);
    default:
      return 'Door Delivery';
  }
}

export function getDeliveryMethodSummary(
  deliveryMethod: DeliveryMethod,
  selectedQuote: ShippingQuote | undefined,
  deliveryState?: string | null
): string {
  if (deliveryMethod === 'airport') {
    return `Delivery to your doorstep • ${AIRPORT_DELIVERY_ESTIMATE}`;
  }

  if (deliveryMethod === 'pickup_station') {
    return isProviderStationPickupQuote(selectedQuote)
      ? getPickupStationAddressText(selectedQuote)
      : MERCHANT_OFFICE_PICKUP_LABEL;
  }

  const doorQuote = isRoadDeliveryQuote(selectedQuote)
    ? selectedQuote
    : undefined;
  const carrier =
    doorQuote?.carrierName || doorQuote?.provider || DEFAULT_CARRIER;
  if (deliveryState?.trim().toLowerCase() === 'lagos') {
    return `${carrier} • ${LAGOS_ROAD_DELIVERY_ESTIMATE}`;
  }
  const eta =
    doorQuote?.deliveryRange ||
    (doorQuote?.estimatedDays
      ? `${doorQuote.estimatedDays} days`
      : 'Delivery estimate shown after selection');

  return `${carrier} • ${eta}`;
}

export function getDeliveryMethodReviewDetail(
  deliveryMethod: DeliveryMethod,
  selectedQuote: ShippingQuote | undefined,
  deliveryState?: string | null
): string | undefined {
  if (deliveryMethod === 'airport') {
    return `Delivery to your doorstep • ${AIRPORT_DELIVERY_ESTIMATE}`;
  }

  if (deliveryMethod === 'pickup_station') {
    return isProviderStationPickupQuote(selectedQuote)
      ? selectedQuote.displayName
      : undefined;
  }

  if (!isRoadDeliveryQuote(selectedQuote)) return undefined;

  const eta =
    deliveryState?.trim().toLowerCase() === 'lagos'
      ? LAGOS_ROAD_DELIVERY_ESTIMATE
      : selectedQuote.deliveryRange ||
        (selectedQuote.estimatedDays
          ? `${selectedQuote.estimatedDays} days`
          : 'Delivery estimate shown after selection');

  return `${selectedQuote.displayName} • ${eta}`;
}

export function getShippingProviderForMethod(
  deliveryMethod: DeliveryMethod,
  selectedQuote: ShippingQuote | undefined
): string | undefined {
  if (deliveryMethod === 'pickup_station') {
    return isProviderStationPickupQuote(selectedQuote)
      ? selectedQuote.provider || selectedQuote.carrierName
      : undefined;
  }
  if (deliveryMethod === 'airport') {
    return selectedQuote && isGiglGoFasterQuote(selectedQuote)
      ? selectedQuote.provider || selectedQuote.carrierName
      : undefined;
  }
  if (deliveryMethod !== 'door') return undefined;
  return isRoadDeliveryQuote(selectedQuote)
    ? selectedQuote.provider || selectedQuote.carrierName
    : undefined;
}

export function isGiglGoFasterQuote(quote: ShippingQuote | undefined): boolean {
  return (
    quote !== undefined &&
    !isProviderStationPickupQuote(quote) &&
    quote.provider?.toUpperCase() === 'GIGL' &&
    quote.serviceTier?.toLowerCase().includes('gofaster') === true
  );
}

export function isRoadDeliveryQuote(
  quote: ShippingQuote | undefined
): quote is ShippingQuote {
  return (
    quote !== undefined &&
    !isProviderStationPickupQuote(quote) &&
    !isGiglGoFasterQuote(quote)
  );
}

export function findSelectedQuote(
  shippingQuotes: ShippingQuote[],
  selectedQuoteId: string | undefined
): ShippingQuote | undefined {
  return shippingQuotes.find(
    (quote) => String(quote.id) === String(selectedQuoteId)
  );
}

/**
 * Resolve the quote selection for door delivery: keep the current selection
 * when it is a road quote, otherwise fall back to the first road quote (or
 * clear the selection when none exists so quotes re-resolve). A stale air
 * (GoFaster) or station quote must never survive a fallback to door — door
 * pricing treats it as zero while the order builder could still send its ID.
 */
export function resolveDoorDeliveryQuoteId(
  shippingQuotes: ShippingQuote[],
  selectedQuoteId: string | undefined
): string {
  const selectedQuote = findSelectedQuote(shippingQuotes, selectedQuoteId);
  if (selectedQuote && isRoadDeliveryQuote(selectedQuote)) {
    return String(selectedQuote.id);
  }
  const roadQuote = shippingQuotes.find(isRoadDeliveryQuote);
  return roadQuote ? String(roadQuote.id) : '';
}

export function requiresQuote(
  deliveryMethod: DeliveryMethod,
  selectedQuote: ShippingQuote | undefined,
  usesProviderPickup: boolean
): boolean {
  return (
    deliveryMethod === 'door' ||
    usesProviderPickup ||
    isProviderStationPickupQuote(selectedQuote) ||
    (deliveryMethod === 'airport' && isGiglGoFasterQuote(selectedQuote))
  );
}
