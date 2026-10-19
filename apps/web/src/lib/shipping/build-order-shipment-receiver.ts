import { OrderShipmentBookingError } from './order-shipment-booking-error';
import type { ShippingAddress } from './types';

type OrderShippingAddress = {
  address?: string | null;
  city?: string | null;
  country?: string | null;
  countryCode?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  postalCode?: string | null;
  state?: string | null;
  phone?: string | null;
};

export type OrderForShipmentReceiver = {
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  shipping_address: OrderShippingAddress | null;
};

function boundedCoordinate(
  value: number | string | null | undefined,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

export function buildOrderShipmentReceiver(
  order: OrderForShipmentReceiver,
  options: { allowCoordinatesWithoutCityState?: boolean } = {}
): ShippingAddress {
  const shippingAddress = order.shipping_address ?? {};
  const address = shippingAddress.address?.trim();
  const city = shippingAddress.city?.trim();
  const state = shippingAddress.state?.trim();
  const phone =
    shippingAddress.phone?.trim() || order.customer_phone?.trim() || '';
  const latitude = boundedCoordinate(shippingAddress.latitude, -90, 90);
  const longitude = boundedCoordinate(shippingAddress.longitude, -180, 180);
  const hasFiniteCoordinates =
    latitude !== undefined && longitude !== undefined;
  const allowCoordinatesWithoutCityState =
    options.allowCoordinatesWithoutCityState === true &&
    hasFiniteCoordinates &&
    Boolean(phone);

  if (!address || (!allowCoordinatesWithoutCityState && (!city || !state))) {
    throw new OrderShipmentBookingError(
      'This order is missing a complete shipping address.',
      400,
      'INCOMPLETE_SHIPPING_ADDRESS'
    );
  }

  return {
    name: order.customer_name || 'Customer',
    email: order.customer_email || undefined,
    phone,
    address,
    city: city || '',
    state: state || '',
    country: shippingAddress.country?.trim() || 'Nigeria',
    countryCode: shippingAddress.countryCode?.trim() || 'NG',
    postalCode: shippingAddress.postalCode?.trim() || undefined,
    ...(hasFiniteCoordinates
      ? {
          latitude,
          longitude,
        }
      : {}),
  };
}
