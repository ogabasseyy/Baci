export interface CancellationRpcFailure {
  code: string | undefined;
  error: string;
  status: 400 | 403 | 404 | 409 | 500;
}

/**
 * Map a cancel_order_as_merchant error to a safe client response. PostgREST
 * can wrap the raised sentinel with context, so sentinels are matched as
 * substrings: exact equality would silently demote a 409
 * PAYMENT_RECONCILIATION_REQUIRED to a generic failure.
 */
export function mapCancellationRpcError(error: {
  code?: string;
  message: string;
}): CancellationRpcFailure {
  if (
    error.code === 'P0001' &&
    error.message.includes('payment_capture_in_flight')
  ) {
    return {
      code: 'PAYMENT_RECONCILIATION_REQUIRED',
      error:
        'A payment attempt needs to be checked before this order can be cancelled. Please contact support.',
      status: 409,
    };
  }
  if (error.code === 'P0001') {
    return {
      code: 'ORDER_NOT_CANCELLABLE',
      error: 'This order can no longer be cancelled.',
      status: 409,
    };
  }
  if (error.code === 'P0002') {
    return { code: undefined, error: 'Order not found', status: 404 };
  }
  if (error.code === '42501') {
    if (error.message.includes('order_cancel_refund_forbidden')) {
      return {
        code: 'CANCEL_REFUND_FORBIDDEN',
        error:
          'Only the store owner or staff with refund permission can cancel an order without an automatic refund.',
        status: 403,
      };
    }
    return {
      code: undefined,
      error: 'You do not have permission to cancel this order.',
      status: 403,
    };
  }
  if (error.code === '22023' && error.message.includes('invalid_refund_mode')) {
    return {
      code: 'INVALID_REFUND_MODE',
      error: 'Invalid refund option.',
      status: 400,
    };
  }
  return { code: undefined, error: 'Failed to cancel order', status: 500 };
}
