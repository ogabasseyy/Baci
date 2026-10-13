import { describe, expect, it } from 'vitest';
import { OrderShipmentBookingError } from './order-shipment-booking-error';

describe('OrderShipmentBookingError', () => {
  it('retains booking status and stable error code', () => {
    const error = new OrderShipmentBookingError('failed', 409, 'BOOKING_BUSY');

    expect(error).toMatchObject({
      message: 'failed',
      name: 'OrderShipmentBookingError',
      status: 409,
      code: 'BOOKING_BUSY',
    });
  });
});
