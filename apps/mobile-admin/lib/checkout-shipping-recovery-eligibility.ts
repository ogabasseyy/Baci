import type { Order } from '@baci/shared';

/** UI eligibility only; the server still enforces activation, scope and funding. */
export function canUseCheckoutShippingRecovery(
  order:
    | Pick<
        Order,
        | 'merchant_id'
        | 'payment_status'
        | 'shipping_status'
        | 'shipping_funding_source'
        | 'shipping_provider'
        | 'shipment_id'
        | 'tracking_number'
      >
    | undefined,
  merchant: { id: string; user_id?: string | null } | null,
  userId?: string | null
): boolean {
  return Boolean(
    order &&
      userId &&
      merchant?.user_id === userId &&
      merchant.id === order.merchant_id &&
      order.payment_status === 'paid' &&
      order.shipping_status === 'processing' &&
      order.shipping_funding_source === 'customer_checkout' &&
      order.shipping_provider?.toUpperCase() === 'GIGL' &&
      !order.shipment_id &&
      !order.tracking_number
  );
}
