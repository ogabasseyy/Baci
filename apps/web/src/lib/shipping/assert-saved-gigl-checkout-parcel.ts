import { assertDomesticQuoteItemsMatchOrder } from './assert-domestic-quote-items-match-order';
import { assertQuoteItemsMatchOrder } from './international-quote-items-match';
import {
  assertShippableBookingItems,
  type OrderItemRecord,
  OrderShipmentBookingError,
  toDomesticBookingItems,
  toQuoteComparableOrderItems,
} from './order-shipment-booking-utils';
import type { QuoteRequest } from './types';

/** A changed parcel needs consent; invalid snapshots still fail existing guards. */
export function assertSavedGiglCheckoutParcel(
  request: QuoteRequest,
  orderItems: OrderItemRecord[] | null
): void {
  assertDomesticQuoteItemsMatchOrder(request, orderItems, 1);
  assertShippableBookingItems(
    toDomesticBookingItems(orderItems ?? [], request.items, 1)
  );
  try {
    assertQuoteItemsMatchOrder(
      request,
      toQuoteComparableOrderItems(orderItems, { defaultWeight: 1 })
    );
  } catch (error) {
    if (
      !(error instanceof OrderShipmentBookingError) ||
      error.code !== 'SHIPPING_QUOTE_ITEMS_MISMATCH'
    )
      throw error;
    throw new OrderShipmentBookingError(
      'The shipment items changed. Review and confirm the shipping details and quote before booking.',
      409,
      'SHIPPING_QUOTE_RECONFIRM_REQUIRED'
    );
  }
}
