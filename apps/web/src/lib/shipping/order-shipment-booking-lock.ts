import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';

const DEFAULT_LOCK_TIMEOUT_SECONDS = 15 * 60;
const RPC_ERROR_CODE_PATTERN = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/;

type ClaimOrderShipmentBookingRow = {
  claimed: boolean;
  shipment_id: string | null;
  tracking_number: string | null;
  shipping_status: string | null;
};

export type ClaimOrderShipmentBookingResult =
  | { status: 'claimed'; lockToken: string | null }
  | { status: 'already_booked' }
  | { status: 'in_progress' };

type RpcErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

function isMissingBookingLockInfrastructure(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const rpcError = error as RpcErrorLike;
  const haystack = [rpcError.message, rpcError.details, rpcError.hint]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  return (
    rpcError.code === '42883' ||
    rpcError.code === 'PGRST202' ||
    haystack.includes('claim_order_shipment_booking') ||
    haystack.includes('schema cache')
  );
}

function getRpcErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'UNKNOWN';
  }

  const code = (error as RpcErrorLike).code;
  return typeof code === 'string' && RPC_ERROR_CODE_PATTERN.test(code)
    ? code
    : 'UNKNOWN';
}

function getClaimRow(
  value: ClaimOrderShipmentBookingRow[] | ClaimOrderShipmentBookingRow | null
): ClaimOrderShipmentBookingRow | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

export async function claimOrderShipmentBooking(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  lockTimeoutSeconds = DEFAULT_LOCK_TIMEOUT_SECONDS
): Promise<ClaimOrderShipmentBookingResult> {
  const lockToken = crypto.randomUUID();
  const { data, error } = await supabase.rpc('claim_order_shipment_booking', {
    p_order_id: orderId,
    p_merchant_id: merchantId,
    p_lock_token: lockToken,
    p_lock_timeout_seconds: lockTimeoutSeconds,
  });
  const row = getClaimRow(
    data as ClaimOrderShipmentBookingRow[] | ClaimOrderShipmentBookingRow | null
  );

  if (error) {
    if (isMissingBookingLockInfrastructure(error)) {
      console.warn(
        '[Shipping] Shipment booking lock infrastructure unavailable; continuing without DB lock.'
      );
      return {
        status: 'claimed',
        lockToken: null,
      };
    }

    // The claim atomically verifies the order is not refunded while
    // acquiring the lock: a finalized full refund blocks the booking.
    if (
      typeof error === 'object' &&
      typeof (error as RpcErrorLike).message === 'string' &&
      (error as RpcErrorLike).message?.includes('order_refunded_for_shipment')
    ) {
      throw new OrderShipmentBookingError(
        'This order was refunded and can no longer be shipped.',
        400,
        'ORDER_REFUNDED'
      );
    }

    // The claim also rejects cancelled orders: cancellation restocks
    // inventory, so booking one would ship against stock back on sale.
    if (
      typeof error === 'object' &&
      typeof (error as RpcErrorLike).message === 'string' &&
      (error as RpcErrorLike).message?.includes('order_cancelled_for_shipment')
    ) {
      throw new OrderShipmentBookingError(
        'This order was cancelled and can no longer be shipped.',
        400,
        'ORDER_CANCELLED'
      );
    }

    // Partial refunds leave payment_status paid: the claim rejects while a
    // merchandise refund is still settling so the booking cannot ship
    // stale pre-refund units. No lock was acquired, so nothing to release;
    // 409 signals the caller to retry after settlement.
    if (
      typeof error === 'object' &&
      typeof (error as RpcErrorLike).message === 'string' &&
      (error as RpcErrorLike).message?.includes(
        'order_refund_pending_for_shipment'
      )
    ) {
      throw new OrderShipmentBookingError(
        'A refund for this order is still settling. Please try again shortly.',
        409,
        'ORDER_REFUND_PENDING'
      );
    }

    logger.error({
      message: 'Shipment booking lock claim failed',
      rpcCode: getRpcErrorCode(error),
    });

    throw new OrderShipmentBookingError(
      'Failed to reserve this order for shipment booking.',
      500,
      'SHIPMENT_BOOKING_LOCK_FAILED'
    );
  }

  if (!row) {
    throw new OrderShipmentBookingError(
      'Order not found',
      404,
      'ORDER_NOT_FOUND'
    );
  }

  if (row.claimed) {
    return {
      status: 'claimed',
      lockToken,
    };
  }

  if (row.shipment_id || row.tracking_number) {
    return { status: 'already_booked' };
  }

  return { status: 'in_progress' };
}

export async function clearOrderShipmentBookingLock(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  lockToken: string
): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({
      shipment_booking_lock_token: null,
      shipment_booking_started_at: null,
    })
    .eq('id', orderId)
    .eq('merchant_id', merchantId)
    .eq('shipment_booking_lock_token', lockToken);

  if (error) {
    throw new OrderShipmentBookingError(
      'Failed to release the shipment booking lock.',
      500,
      'SHIPMENT_BOOKING_LOCK_RELEASE_FAILED'
    );
  }
}
