/**
 * Merchant push payload for GIGL tracking. Order-backed shipments keep the
 * shipment_tracking deep-link; orderless repair pickups use type=repair so
 * mobile-admin routes to the repair (not the orders list).
 *
 * repair_id must come from the claim projection — never look up repairs via
 * the privileged event-pipeline client.
 */
export function buildGiglTrackingMerchantPushPayload(notification: {
  merchant_id: string;
  order_id: string | null;
  repair_id?: string | null;
  shipment_id: string;
}): Record<string, string> {
  if (notification.order_id) {
    return {
      orderId: notification.order_id,
      type: 'shipment_tracking',
    };
  }

  return notification.repair_id
    ? { type: 'repair', repairId: notification.repair_id }
    : { type: 'repair', shipmentId: notification.shipment_id };
}
