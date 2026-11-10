import { NativeCartError } from './native-cart-error';

const MESSAGES: Record<string, string> = {
  invalid_item:
    'That item is no longer available, so your cart was put back as it was.',
  cart_locked:
    "Your cart is being checked out, so it can't be changed right now.",
  version_conflict:
    'Your cart changed on another device. We refreshed it, so please try again.',
  too_many_lines:
    'Your cart is full. Remove an item before adding another one.',
  rate_limited:
    "You're changing your cart too quickly. Please wait a moment and try again.",
  expired: 'Your cart session ended. Please reopen your cart.',
  not_found: 'Your cart session ended. Please reopen your cart.',
  refresh_required: 'Your cart needs to refresh. Please try again.',
};
const FALLBACK =
  "That change couldn't be saved, so we put your cart back as it was.";

/** Plain-language reason for a rejected cart edit; never exposes raw server detail. */
export function writeFailureMessage(error: unknown): string {
  return (error instanceof NativeCartError && MESSAGES[error.code]) || FALLBACK;
}
