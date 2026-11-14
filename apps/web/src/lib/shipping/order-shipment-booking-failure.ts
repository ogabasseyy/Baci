import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';

export type BookingFailureOutcome =
  | 'not_submitted'
  | 'provider_unconfirmed'
  | 'rejected'
  | 'unexpected';

export type ClassifiedBookingFailure = {
  code: string;
  message: string;
  httpStatus: number | null;
  outcome: BookingFailureOutcome;
};

const MAX_MESSAGE_LENGTH = 500;
const NEVER_REACHED_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

/** True when the connection to the provider never opened, so nothing was booked. */
export function isProviderNeverReachedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = (error as { cause?: { code?: unknown } }).cause;
  return typeof cause?.code === 'string' && NEVER_REACHED_CODES.has(cause.code);
}

/** A call that may have reached GIG but never answered. */
function isProviderTimeoutError(error: unknown): boolean {
  // Only GIG's own booking timeout: a database or client-abort timeout says
  // nothing about whether GIG booked the parcel.
  return (
    error instanceof Error && /^GIGL booking timed out/i.test(error.message)
  );
}

export function classifyBookingFailure(
  error: unknown
): ClassifiedBookingFailure {
  if (error instanceof OrderShipmentBookingError) {
    return {
      code: error.code,
      message: error.message.slice(0, MAX_MESSAGE_LENGTH),
      httpStatus: error.status,
      outcome: 'rejected',
    };
  }
  const message = (
    error instanceof Error ? error.message : String(error)
  ).slice(0, MAX_MESSAGE_LENGTH);
  if (isProviderNeverReachedError(error)) {
    return {
      code: 'PROVIDER_UNREACHABLE',
      message,
      httpStatus: null,
      outcome: 'not_submitted',
    };
  }
  if (!isProviderTimeoutError(error)) {
    return {
      code: 'BOOKING_UNEXPECTED_ERROR',
      message,
      httpStatus: null,
      outcome: 'unexpected',
    };
  }
  return {
    code: 'PROVIDER_UNCONFIRMED',
    message,
    httpStatus: null,
    outcome: 'provider_unconfirmed',
  };
}

/** Best effort: recording a failure must never hide or replace the real error. */
export async function recordOrderShipmentBookingFailure(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  error: unknown,
  lockRetained: boolean
): Promise<void> {
  try {
    const failure = classifyBookingFailure(error);
    const { error: insertError } = await supabase
      .from('order_shipment_booking_failures')
      .insert({
        order_id: orderId,
        merchant_id: merchantId,
        error_code: failure.code,
        error_message: failure.message,
        http_status: failure.httpStatus,
        outcome: failure.outcome,
        lock_retained: lockRetained,
      });
    if (insertError) {
      logger.error({
        message: 'Could not record shipment booking failure',
        orderId,
        error: insertError,
      });
    }
  } catch (recordError) {
    logger.error({
      message: 'Could not record shipment booking failure',
      orderId,
      error: recordError,
    });
  }
}

/**
 * An unconfirmed provider call (timeout) would otherwise surface as a bare 500.
 * Say plainly why the order is paused and that retrying shortly is expected.
 */
export function toBookingFailureResponseError(error: unknown): unknown {
  const { outcome } = classifyBookingFailure(error);
  if (outcome === 'not_submitted') {
    return new OrderShipmentBookingError(
      'We could not reach GIG just now. Nothing was booked; please try again.',
      503,
      'PROVIDER_UNREACHABLE'
    );
  }
  if (outcome !== 'provider_unconfirmed') {
    return error;
  }
  return new OrderShipmentBookingError(
    'GIG did not confirm this booking in time. To avoid booking the parcel twice, this order is paused for up to 15 minutes. Please try again after that.',
    503,
    'SHIPMENT_BOOKING_UNCONFIRMED'
  );
}
