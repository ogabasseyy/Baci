import { assertSavedGiglCheckoutParcel } from './assert-saved-gigl-checkout-parcel';
import type { BookOrderRecord } from './book-order-shipment-types';
import { resolveSavedGiglCheckoutDestination } from './saved-gigl-checkout-destination';
import type { QuoteRequest } from './types';

/** Validate saved checkout details before any tariff lookup or paid submission. */
export function prepareSavedGiglCheckoutBooking(
  provider: string,
  isInternationalQuote: boolean,
  order: BookOrderRecord,
  request: QuoteRequest | null
): { preserveSavedGiglCheckoutQuote: boolean; bookingOrder: BookOrderRecord } {
  const preserveSavedGiglCheckoutQuote =
    provider === 'GIGL' &&
    !isInternationalQuote &&
    order.shipping_funding_source === 'customer_checkout';
  const bookingOrder =
    preserveSavedGiglCheckoutQuote && request
      ? resolveSavedGiglCheckoutDestination(order, request)
      : order;
  if (preserveSavedGiglCheckoutQuote && request) {
    assertSavedGiglCheckoutParcel(request, order.order_items);
  }
  return { preserveSavedGiglCheckoutQuote, bookingOrder };
}
