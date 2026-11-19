import { OrderShipmentBookingError } from '../order-shipment-booking-utils';

/**
 * Maps a non-2xx save-shipment answer. A 4xx is a clear refusal (nothing was
 * created, so the lock can be freed and the reason shown); a 5xx may or may
 * not have created the shipment, so it stays a plain error and keeps the lock.
 */
export function topshipSaveFailure(status: number, message: string): Error {
  if (status >= 400 && status < 500) {
    return new OrderShipmentBookingError(message, 422, 'TOPSHIP_SAVE_REJECTED');
  }
  return new Error(message);
}
