import { OrderShipmentBookingError } from './order-shipment-booking-utils';
import type { ShippingAddress } from './types';

/** A paid partner quote fixes the origin. Current verified contacts can change. */
export function selectOrderBookingSender(
  source: string | null | undefined,
  current: ShippingAddress,
  quoted: ShippingAddress | undefined
): ShippingAddress {
  if (source !== 'partner') return current;
  if (!quoted?.address.trim()) {
    throw new OrderShipmentBookingError(
      'The paid partner quote is missing its pickup origin.',
      409,
      'PARTNER_DELIVERY_ORIGIN_MISSING'
    );
  }
  return {
    ...quoted,
    name: current.name,
    phone: current.phone,
    email: current.email,
  };
}
