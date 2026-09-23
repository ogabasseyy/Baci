import { OrderShipmentBookingError } from './order-shipment-booking-error';

/**
 * Rejects orders that must never reach provider booking: itemless orders
 * and fully-refunded orders. Refund finalization deliberately leaves
 * fulfillmentQuantity unset for review_required inventory, so without this
 * guard the surviving-quantity fallback would report the original
 * quantities as shippable and dispatch fully-refunded items.
 */
export function assertShippableOrderState({
  items,
  paymentStatus,
}: {
  items: readonly unknown[];
  paymentStatus: string | null | undefined;
}): void {
  if (items.length === 0) {
    throw new OrderShipmentBookingError(
      'Cannot book a shipment for an order with no items.',
      400,
      'MISSING_ORDER_ITEMS'
    );
  }
  if ((paymentStatus ?? '').trim().toLowerCase() === 'refunded') {
    throw new OrderShipmentBookingError(
      'This order was refunded and can no longer be shipped.',
      400,
      'ORDER_REFUNDED'
    );
  }
}
