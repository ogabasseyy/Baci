import { assertQuoteItemsMatchOrder } from './international-quote-items-match';
import { OrderShipmentBookingError } from './order-shipment-booking-error';
import { toQuoteComparableOrderItems } from './order-shipment-booking-utils';
import type { QuoteRequest } from './types';

/** Validate one complete snapshot, preserving all product/package checks.
 * Older domestic quotes contain original units; recovered quotes contain only
 * survivors. Shipment construction independently removes refunded units.
 */
export function assertDomesticQuoteItemsMatchOrder(
  quote: QuoteRequest,
  orderItems: unknown,
  defaultWeight: number
): void {
  try {
    assertQuoteItemsMatchOrder(
      quote,
      toQuoteComparableOrderItems(orderItems, { defaultWeight })
    );
    return;
  } catch (error) {
    if (
      !(error instanceof OrderShipmentBookingError) ||
      error.code !== 'SHIPPING_QUOTE_ITEMS_MISMATCH'
    )
      throw error;
  }
  // Retry the entire original multiset, never mix quantity modes per item.
  assertQuoteItemsMatchOrder(
    quote,
    toQuoteComparableOrderItems(orderItems, {
      defaultWeight,
      quantityMode: 'original',
    })
  );
}
