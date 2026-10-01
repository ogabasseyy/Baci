import type { Order, OrderItem } from '@baci/shared';
import { getOrderFulfillmentIdentifierItems } from './order-fulfillment-details';

export {
  areFulfillmentDetailsComplete,
  getFirstIncompleteFulfillmentItemIndex,
  getInitialFulfillmentDetails,
  getOrderFulfillmentIdentifierItems,
  type ShipmentFulfillmentDetails,
  type ShipmentFulfillmentItem,
  shouldPersistFulfillmentDetails,
  updateShipmentFulfillmentDetails,
} from './order-fulfillment-details';
export { buildOrderFulfillmentDetailsForPersistence } from './order-fulfillment-identifiers';

export type ShipmentCompletionMode = 'provider' | 'self_fulfillment';
export type ShipmentFlowStep = 'details' | 'method' | 'rider';

const KNOWN_PROVIDER_LABELS: Record<string, string> = {
  GIGL: 'GIG Logistics',
  SHIIP: 'Shiip',
  TOPSHIP: 'Topship',
};

export function orderRequiresFulfillment(
  items: OrderItem[] | undefined,
  merchantBusinessType?: string | null
): boolean {
  return (
    getOrderFulfillmentIdentifierItems(items, merchantBusinessType).length > 0
  );
}

export function canUseSelectedShippingProvider(
  order: Pick<
    Order,
    | 'selected_quote_id'
    | 'shipment_id'
    | 'shipping_provider'
    | 'tracking_number'
  >
): boolean {
  return Boolean(
    order.shipping_provider &&
      order.selected_quote_id &&
      !order.tracking_number &&
      !order.shipment_id
  );
}

export function formatShippingProviderName(
  provider: string | null | undefined
): string | null {
  if (!provider) {
    return null;
  }

  const normalized = provider.trim();
  if (!normalized) {
    return null;
  }

  return (
    KNOWN_PROVIDER_LABELS[normalized.toUpperCase()] ??
    normalized
      .toLowerCase()
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}

export function getDispatchPhoneFromOrder(
  order: Pick<Order, 'self_fulfillment_data'>
): string {
  return order.self_fulfillment_data?.dispatchPhone?.trim() ?? '';
}

export function getOrderGiglInitialAddress(order: {
  customer_phone?: string | null;
  shipping_address?:
    | {
        address?: string | null;
        city?: string | null;
        state?: string | null;
        phone?: string | null;
        latitude?: number | null;
        longitude?: number | null;
      }
    | string
    | null;
}) {
  const address = order.shipping_address;
  const coordinateAddress =
    typeof address === 'object' && address !== null ? address : undefined;
  const latitude =
    typeof coordinateAddress?.latitude === 'number' &&
    Number.isFinite(coordinateAddress.latitude)
      ? coordinateAddress.latitude
      : undefined;
  const longitude =
    typeof coordinateAddress?.longitude === 'number' &&
    Number.isFinite(coordinateAddress.longitude)
      ? coordinateAddress.longitude
      : undefined;
  const recipientPhone =
    typeof address === 'object' && address?.phone?.trim()
      ? address.phone.trim()
      : order.customer_phone?.trim();
  return {
    ...(typeof address === 'string'
      ? { address }
      : {
          ...(address?.address ? { address: address.address } : {}),
          ...(address?.city ? { city: address.city } : {}),
          ...(address?.state ? { state: address.state } : {}),
        }),
    ...(recipientPhone ? { phone: recipientPhone } : {}),
    ...(latitude !== undefined && longitude !== undefined
      ? { latitude, longitude }
      : {}),
  };
}
