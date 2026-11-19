import { OrderShipmentBookingError } from '../order-shipment-booking-error';
import { BOOKED_SHIPMENT_NOT_SAVED_CODE } from '../order-shipment-booking-failure';

/**
 * Parses the pay-from-wallet answer for a shipment Topship already saved. A
 * malformed success body is not "unexpected": the parcel exists, so it becomes
 * a booked-but-not-saved error that keeps the lock and carries the tracking id
 * for reconciliation.
 */
export function parsePaidShipmentAfterSave<T>(
  parse: () => T,
  trackingId: string | undefined
): T {
  try {
    return parse();
  } catch {
    throw new OrderShipmentBookingError(
      `The carrier saved the shipment but its payment confirmation could not be read (tracking ${trackingId ?? 'unknown'}). Check the shipment before booking again.`,
      502,
      BOOKED_SHIPMENT_NOT_SAVED_CODE,
      trackingId ?? undefined
    );
  }
}
