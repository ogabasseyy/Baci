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
const MAX_CODE_LENGTH = 64;
/** The message GIG's booking client throws when its own deadline passes. */
export const GIGL_BOOKING_TIMEOUT_MESSAGE = 'GIGL booking timed out';
export const GIGL_INTERNATIONAL_BOOKING_TIMEOUT_MESSAGE =
  'GIGL international booking timed out';

// Deliberately partial: only dial-level failures that prove nothing was sent.
// ETIMEDOUT, ECONNRESET and EPIPE can happen after the request left, so those
// stay locked (fail safe against double booking).
const NEVER_REACHED_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

/** True when the connection to the provider never opened, so nothing was booked. */
export function isProviderNeverReachedError(error: unknown): boolean {
  // Node's fetch wraps the system error in `cause`, sometimes one level deeper.
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 3 && typeof current === 'object' && current !== null;
    depth += 1
  ) {
    const { code, cause } = current as {
      code?: unknown;
      cause?: unknown;
    };
    if (typeof code === 'string' && NEVER_REACHED_CODES.has(code)) return true;
    current = cause;
  }
  return false;
}

/** A call that may have reached GIG but never answered (also when wrapped). */
function isProviderTimeoutError(error: unknown): boolean {
  // Only GIG's own booking timeouts: a database or client-abort timeout says
  // nothing about whether GIG booked the parcel.
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current instanceof Error; depth += 1) {
    if (
      current.message.startsWith(GIGL_BOOKING_TIMEOUT_MESSAGE) ||
      current.message.startsWith(GIGL_INTERNATIONAL_BOOKING_TIMEOUT_MESSAGE)
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function classifyBookingFailure(
  error: unknown
): ClassifiedBookingFailure {
  if (error instanceof OrderShipmentBookingError) {
    return {
      code: error.code.slice(0, MAX_CODE_LENGTH),
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
export function toBookingFailureResponseError(
  error: unknown,
  options: { walletFunded?: boolean } = {}
): unknown {
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
  if (options.walletFunded) {
    // The wallet charge is held for reconciliation, so waiting will not help.
    return new OrderShipmentBookingError(
      'GIG did not confirm this booking in time and your wallet charge is being checked. Please contact support before trying again.',
      503,
      'SHIPMENT_BOOKING_UNCONFIRMED'
    );
  }
  return new OrderShipmentBookingError(
    'GIG did not confirm this booking in time. To avoid booking the parcel twice, this order is paused for up to 15 minutes. Please try again after that.',
    503,
    'SHIPMENT_BOOKING_UNCONFIRMED'
  );
}
