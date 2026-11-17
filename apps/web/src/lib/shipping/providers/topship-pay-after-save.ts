import { OrderShipmentBookingError } from '../order-shipment-booking-error';
import { BOOKED_SHIPMENT_NOT_SAVED_CODE } from '../order-shipment-booking-failure';

interface PayAfterSaveInput {
  fetchPayment: () => Promise<Response>;
  log: (
    level: 'error',
    message: string,
    context: Record<string, unknown>
  ) => void;
  trackingId: string | undefined;
}

/**
 * Sends the pay-from-wallet request for a shipment Topship already saved.
 * A connection error here is NOT "never reached": the shipment exists, so it
 * throws a plain error (no network code) and the booking lock stays held
 * instead of allowing a duplicate shipment. Do NOT attach the original as
 * `cause`: the never-reached check walks the cause chain and would release it.
 */
export async function requestTopshipPaymentAfterSave({
  fetchPayment,
  log,
  trackingId,
}: PayAfterSaveInput): Promise<Response> {
  try {
    return await fetchPayment();
  } catch (error) {
    const networkCode = (error as { code?: unknown } | null)?.code;
    log('error', 'Topship payment request failed after save', {
      trackingId,
      error: error instanceof Error ? error.message : String(error),
      errorCode: networkCode,
      stack: error instanceof Error ? error.stack : undefined,
    });
    // A coded booking error keeps the lock (the code is not releasable) and
    // records outcome booked_not_saved, since the parcel exists at Topship.
    throw new OrderShipmentBookingError(
      `The carrier saved the shipment but could not confirm payment (tracking ${trackingId ?? 'unknown'}). Check the shipment before booking again.${typeof networkCode === 'string' ? ` [${networkCode}]` : ''}`,
      503,
      BOOKED_SHIPMENT_NOT_SAVED_CODE
    );
  }
}
