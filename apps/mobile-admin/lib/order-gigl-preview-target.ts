import type { OrderGiglReceiver } from './order-gigl-shipping';
import {
  toCompleteOrderGiglReceiver,
  toOrderGiglAddressDraft,
} from './order-gigl-shipping-state';
import { getOrderGiglInitialAddress } from './order-shipment';

export type OrderGiglPreviewTargetOrder = Parameters<
  typeof getOrderGiglInitialAddress
>[0] & {
  id?: string | null;
  selected_quote_id?: string | null;
  shipment_id?: string | null;
  shipping_funding_source?: string | null;
  shipping_status?: string | null;
  tracking_number?: string | null;
};

export interface OrderGiglPreviewTarget {
  orderId: string;
  receiver: OrderGiglReceiver;
}

/**
 * Returns the receiver to price in the background, or null when the GIG panel
 * would not need a fresh preview (or the server would refuse one).
 */
export function resolveOrderGiglPreviewTarget(
  order: OrderGiglPreviewTargetOrder | null | undefined
): OrderGiglPreviewTarget | null {
  if (!order?.id) return null;
  // The quote endpoint refuses orders that are not processing yet.
  if (order.shipping_status?.trim().toLowerCase() !== 'processing') {
    return null;
  }
  if (order.shipment_id || order.tracking_number) return null;
  // Saved quotes (checkout-paid or wallet-bound) book against that quote, and
  // checkout-funded shipping must never be repriced from the merchant wallet.
  if (
    order.selected_quote_id ||
    order.shipping_funding_source === 'customer_checkout'
  ) {
    return null;
  }
  // Same receiver the GIG panel derives, so the sheet hits this cache entry.
  const receiver = toCompleteOrderGiglReceiver(
    toOrderGiglAddressDraft(getOrderGiglInitialAddress(order))
  );
  return receiver ? { orderId: order.id, receiver } : null;
}
