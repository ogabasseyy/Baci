export type SelfFulfillRpcError = {
  code?: string | null;
  message?: string | null;
};

export type MappedSelfFulfillRpcError = {
  status: 400 | 403 | 409 | 500;
  error: string;
  code?: string;
};

/**
 * Maps self_fulfill_order_with_wallet_release failures to HTTP responses.
 * Settled GIGL retention is an expected business conflict (409), not a 500.
 * Missing orders:edit/orders:fulfill raises SQLSTATE 42501 (order_not_owned).
 */
export function mapSelfFulfillRpcError(
  fulfillError: SelfFulfillRpcError
): MappedSelfFulfillRpcError {
  const message = fulfillError.message ?? '';

  if (
    fulfillError.code === '55P03' ||
    message.includes('active_merchant_shipping_charge') ||
    message.includes('active_shipment_booking_lock')
  ) {
    return {
      status: 409,
      error: 'Order has an active shipping booking',
      code: 'ACTIVE_SHIPPING_BOOKING',
    };
  }

  if (
    fulfillError.code === 'P0001' &&
    message.includes('settled_checkout_retention_blocks_self_fulfillment')
  ) {
    return {
      status: 409,
      error:
        'Shipping retention has already settled for this order, so self-fulfillment is unavailable.',
      code: 'SETTLED_CHECKOUT_RETENTION_BLOCKS_SELF_FULFILLMENT',
    };
  }

  if (
    fulfillError.code === 'P0001' &&
    message.includes('order_already_shipped')
  ) {
    return {
      status: 400,
      error: 'Order has already been shipped',
      code: 'ORDER_ALREADY_SHIPPED',
    };
  }

  if (fulfillError.code === '42501' || message.includes('order_not_owned')) {
    return {
      status: 403,
      error: 'You do not have permission to self-fulfill this order',
      code: 'ORDER_NOT_OWNED',
    };
  }

  return {
    status: 500,
    error: 'Failed to update order',
  };
}
