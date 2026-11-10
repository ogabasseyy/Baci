import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import type { SharedCartWrite } from '@/stores/shared-cart-writer';
import { NativeCartError } from './native-cart-error';
import { isPredictableEdit } from './pending-edits';

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

const UNCONFIRMED =
  "We're still saving that change. Your cart will update in a moment.";

/** Plain-language reason for a failed cart edit; never exposes raw server detail. */
export function writeFailureMessage(
  error: unknown,
  outcome: 'rolled_back' | 'unconfirmed' = 'rolled_back'
): string {
  if (outcome === 'unconfirmed') return UNCONFIRMED;
  return (error instanceof NativeCartError && MESSAGES[error.code]) || FALLBACK;
}

/** Tells the shopper about a failed tap; background repricing and restores stay silent. */
export function reportWriteFailure(
  action: SharedCartWrite,
  error: unknown,
  outcome: 'rolled_back' | 'unconfirmed'
): void {
  if (isPredictableEdit(action))
    useNativeSharedCartStore.setState({
      writeNotice: writeFailureMessage(error, outcome),
    });
}
