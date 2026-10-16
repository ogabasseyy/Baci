import type { CartErrorCode } from '@baci/shared/cart';

const SAFE_MESSAGES: Record<CartErrorCode, string> = {
  cart_locked:
    'This cart is closed for checkout. Start a new cart to keep shopping.',
  expired: 'This cart has expired. Start a new cart to keep shopping.',
  handoff_consumed:
    'This cart link was already used. Ask the sender for a fresh link.',
  merge_conflict:
    'Some items differ between the carts. Choose which version to keep.',
  idempotency_conflict:
    'This change was already sent with different details. Refresh and try again.',
  invalid_item: 'One of these items is no longer available as requested.',
  merchant_unavailable: 'This store is not available right now.',
  not_found: 'We could not find this cart.',
  rate_limited: 'Too many cart updates. Wait a moment and try again.',
  refresh_required: 'Your cart changed elsewhere. Refresh to see the latest.',
  temporarily_unavailable:
    'The cart is temporarily unavailable. Your items are saved; try again.',
  too_many_lines:
    'This cart has too many different items. Remove some items and try again.',
  unauthorized: 'Your cart session ended. Reconnect to keep shopping.',
  version_conflict:
    'Your cart changed on another device. Refresh to see the latest.',
};

/** Shopper-safe message for a cart error code. */
export function safeCartErrorMessage(code: CartErrorCode): string {
  return SAFE_MESSAGES[code];
}

/**
 * Whether the caller may retry with the SAME operation ID. Version and
 * idempotency conflicts need refreshed intent, never a blind retry.
 */
export function isRetryableCartError(code: CartErrorCode): boolean {
  return code === 'temporarily_unavailable' || code === 'rate_limited';
}

/** Maps transport/unknown failures to a fail-closed cart error code. */
export function cartErrorFromUnknown(_error: unknown): CartErrorCode {
  return 'temporarily_unavailable';
}
