import {
  ApiError,
  NetworkError,
  RetryExhaustedError,
  TimeoutError,
} from '@/lib/api';
import { DeferredOfflineMutationError } from '@/lib/deferred-offline-mutation-error';
import { createLogger } from '@/lib/logger';
import { trackError } from '@/services/analytics';

const log = createLogger('Order');
const REDACTED_API_ERROR_BODY = '[REDACTED]';

export class OrderError extends Error {
  code: string;
  details?: unknown;
  /**
   * The exact quiz voucher token the orders API rejected, when it identified a
   * single failed line. Lets checkout prune only that voucher line instead of
   * every voucher in a multi-prize cart.
   */
  rejectedVoucherToken?: string;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = 'OrderError';
    this.code = code;
    this.details = details;
  }
}

const ORDER_VALIDATION_ERROR_MESSAGES: Record<string, string> = {
  insufficient_stock:
    'This item is no longer available in the selected quantity. Please update your cart and try again.',
  insufficient_variant_stock:
    'This item is no longer available in the selected option. Please update your cart and try again.',
  invalid_items: 'One or more cart items are no longer available.',
  order_total_mismatch:
    'Your cart total changed. Please review your order and try again.',
  shipping_quote_required:
    'Delivery pricing changed. Please return to delivery and select a shipping option again.',
  tax_amount_mismatch:
    'Your order total changed. Please review your order and try again.',
  // Quiz prize voucher rejections. /api/orders returns the specific reason in
  // `details`/`code` while keeping a generic top-level `error`; map both the
  // route-level (QUIZ_VOUCHER_*) and DB RPC (quiz_voucher_*) codes so the
  // shopper is told what actually went wrong, not just "could not create order".
  // Keys are matched case-insensitively (see getValidationErrorMessage).
  quiz_voucher_token_invalid:
    'This prize voucher is no longer valid. Reopen your prize from the quiz and try again.',
  quiz_voucher_quantity_invalid:
    'A prize can only be claimed one at a time. Set the quantity to 1 and try again.',
  quiz_voucher_multiple:
    'You can redeem only one prize voucher per order. Remove the extra prize line and try again.',
  quiz_voucher_auth_required: 'Please sign in to claim your prize.',
  quiz_voucher_token_expired:
    'This prize voucher has expired. Play again for another chance to win.',
  quiz_voucher_token_config_missing:
    'Prize checkout is temporarily unavailable. Please try again later.',
  quiz_voucher_invalid:
    'This prize voucher is no longer valid. Reopen your prize from the quiz and try again.',
  quiz_voucher_user_required: 'Please sign in to claim your prize.',
  quiz_voucher_award_not_found:
    "We couldn't find this prize on your account. Reopen it from the quiz and try again.",
  quiz_voucher_award_not_approved:
    'This prize is not available to claim yet. Please try again later.',
  quiz_voucher_award_invalid_type:
    'This prize voucher is no longer valid. Reopen your prize from the quiz and try again.',
  quiz_voucher_order_item_not_found:
    'This prize could not be matched to your cart. Reopen it from the quiz and try again.',
};

export function readResponseString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function lookupOrderMessage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  // The server emits some codes upper-case (route-level, e.g.
  // QUIZ_VOUCHER_MULTIPLE) and some lower-case (DB RPC, e.g.
  // quiz_voucher_award_not_found). Match either against the lower-case map.
  return (
    ORDER_VALIDATION_ERROR_MESSAGES[code] ??
    ORDER_VALIDATION_ERROR_MESSAGES[code.toLowerCase()]
  );
}

export function getValidationErrorMessage(
  error: string,
  details: unknown
): string {
  return (
    lookupOrderMessage(readResponseString(details)) ??
    lookupOrderMessage(error) ??
    error
  );
}

function normalizeConflictCode(value: unknown): string {
  const rawCode = readResponseString(value);
  if (!rawCode) return 'ORDER_CONFLICT';

  const normalizedCode = rawCode
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toUpperCase();

  if (normalizedCode === 'ORDER_NOT_REUSABLE') {
    return 'CHECKOUT_ORDER_NOT_REUSABLE';
  }

  if (
    normalizedCode === 'CHECKOUT_ORDER_NOT_REUSABLE' ||
    normalizedCode === 'CHECKOUT_IDEMPOTENCY_CONFLICT'
  ) {
    return normalizedCode;
  }

  return normalizedCode;
}

function getErrorDiagnostics(error: Error): Record<string, unknown> {
  const diagnostics: Record<string, unknown> = {
    message: error.message,
    name: error.name,
  };

  if (error instanceof ApiError) {
    diagnostics.status = error.status;
    diagnostics.statusText = error.statusText;
    diagnostics.body = REDACTED_API_ERROR_BODY;
  }

  return diagnostics;
}

export async function throwOrderHttpError(
  response: Response,
  startTime: number
): Promise<never> {
  const errorData = (await response.json().catch(() => ({}))) as {
    code?: unknown;
    details?: unknown;
    error?: unknown;
    rejectedVoucherToken?: unknown;
  };
  const errorMessage =
    readResponseString(errorData.error) ||
    `Order creation failed (${response.status})`;

  trackError('order_creation_failed', errorMessage, {
    status: response.status,
    duration_ms: Date.now() - startTime,
  });

  if (response.status === 400) {
    const details = errorData.details ?? errorData.code;
    const orderError = new OrderError(
      getValidationErrorMessage(errorMessage, details),
      'VALIDATION_ERROR',
      details
    );
    // Carry the server-identified rejected voucher token so checkout prunes
    // only that line, preserving other valid vouchers in a multi-prize cart.
    const rejectedVoucherToken = readResponseString(
      errorData.rejectedVoucherToken
    );
    if (rejectedVoucherToken) {
      orderError.rejectedVoucherToken = rejectedVoucherToken;
    }
    throw orderError;
  }

  if (response.status === 401) {
    throw new OrderError(
      'Session expired. Please sign in again.',
      'AUTH_ERROR'
    );
  }

  if (response.status === 404) {
    const notFoundMessage = /merchant not found/i.test(errorMessage)
      ? 'Checkout is temporarily unavailable for this store. Please try again later.'
      : errorMessage;
    throw new OrderError(notFoundMessage, 'NOT_FOUND');
  }

  if (response.status === 409) {
    const conflictCode = normalizeConflictCode(errorData.code);
    const conflictDetails =
      errorData.details ??
      (typeof errorData === 'object' && errorData !== null
        ? { ...errorData, code: conflictCode }
        : conflictCode);
    throw new OrderError(errorMessage, conflictCode, conflictDetails);
  }

  if (response.status >= 500) {
    throw new OrderError(
      'Server error. Please try again in a few moments.',
      'SERVER_ERROR'
    );
  }

  throw new OrderError(errorMessage, 'UNKNOWN_ERROR');
}

export function mapCreateOrderException(
  error: unknown,
  startTime: number
): OrderError {
  if (error instanceof DeferredOfflineMutationError) {
    throw error;
  }
  if (error instanceof OrderError) return error;

  if (error instanceof RetryExhaustedError) {
    const lastError =
      error.lastError instanceof Error
        ? error.lastError
        : new Error(String(error.lastError ?? 'Unknown error'));
    log.warn('Create order request failed before retry completion', {
      attempts: error.attempts,
      lastError: getErrorDiagnostics(lastError),
    });
    trackError('order_creation_retry_exhausted', error.message, {
      attempts: error.attempts,
      lastError: lastError.message,
      duration_ms: Date.now() - startTime,
    });
    return new OrderError(
      'Unable to complete order after multiple attempts. Please try again later.',
      'RETRY_EXHAUSTED'
    );
  }

  if (error instanceof TimeoutError) {
    trackError('order_creation_timeout', error.message, {
      duration_ms: Date.now() - startTime,
    });
    return new OrderError(
      'Request timed out. Please check your connection and try again.',
      'TIMEOUT_ERROR'
    );
  }

  if (error instanceof NetworkError) {
    trackError('order_creation_network_error', error.message, {
      duration_ms: Date.now() - startTime,
    });
    return new OrderError(
      'Network error. Please check your connection and try again.',
      'NETWORK_ERROR'
    );
  }

  if (error instanceof ApiError) {
    trackError('order_creation_api_error', error.message, {
      status: error.status,
      duration_ms: Date.now() - startTime,
    });
    return new OrderError(
      'Server error. Please try again in a few moments.',
      'SERVER_ERROR'
    );
  }

  if (error instanceof TypeError && error.message.includes('Network')) {
    trackError('order_creation_network_error', error.message, {
      duration_ms: Date.now() - startTime,
    });
    return new OrderError(
      'Network error. Please check your connection and try again.',
      'NETWORK_ERROR'
    );
  }

  trackError(
    'order_creation_exception',
    error instanceof Error ? error.message : 'Unknown error',
    { duration_ms: Date.now() - startTime }
  );
  return new OrderError(
    'Something went wrong. Please try again.',
    'UNKNOWN_ERROR',
    error
  );
}
