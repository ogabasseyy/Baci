import { readCartSessionHint, writeCartSessionHint } from './cart-session-hint';

/**
 * Stamps `'0'` when an initial cold visit skips fetching so subsequent
 * visits remain silent until a mutation or sign-in occurs.
 */
export function stampSkippedEmptyGuestCartHint(
  merchantId?: string | null
): void {
  if (readCartSessionHint(merchantId) === null) {
    writeCartSessionHint(merchantId, '0');
  }
}
