import { type Order, readCancellationSideEffects } from '@baci/shared';

export interface CancellationRefundDetails {
  currency?: string | null;
  inFlightAmount?: number;
  remainingAmount?: number;
}

/**
 * What a status update resolves with: the (possibly partial) order plus, for
 * a cancellation, what the server reports it did about the refund.
 */
export type OrderStatusUpdateResult = Partial<Order> &
  Pick<Order, 'id'> & {
    refund_details?: CancellationRefundDetails;
    refund_outcome?: string;
  };

/** Reads the refund outcome and details from a cancel response body. */
export function readCancellationRefundResult(
  payload: unknown
): Pick<OrderStatusUpdateResult, 'refund_details' | 'refund_outcome'> {
  const sideEffects =
    payload && typeof payload === 'object' && 'sideEffects' in payload
      ? payload.sideEffects
      : undefined;
  // Malformed details become an `unknown` outcome with no amounts.
  const { details, outcome } = readCancellationSideEffects(sideEffects);
  return {
    ...(outcome && { refund_outcome: outcome }),
    ...(details && { refund_details: details }),
  };
}
