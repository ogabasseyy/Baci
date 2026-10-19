import { parseHandoffLines } from './parse-handoff-lines';

// True when the stored cart link is a validated Ogabassey handoff that
// still carries lines: another surface may hold the only lines under a
// shared token, and Review must stay reachable for those foreign-only
// carts instead of stranding them behind an empty local cart.
export function hasReviewableHandoffLines(
  cartUrl: string | undefined
): boolean {
  if (!cartUrl) return false;
  let review: string | null;
  try {
    review = buildReviewCartUrl(cartUrl);
  } catch {
    return false;
  }
  if (!review) return false;
  const lines = parseHandoffLines(
    new URL(review).searchParams.get('guest_cart')
  );
  return (lines?.length ?? 0) > 0;
}

// Builds the idempotent Review URL from the stored cart link: legacy
// one-shot `?item_id=&qty=` handoffs replay the add on every open, so Review
// keeps only the idempotent `guest_cart` payload and otherwise opens the bare
// cart. The payload is re-parsed before re-emitting so a malformed stored
// value opens the bare cart instead of propagating to the website. Returns
// null when the stored URL is not a usable Ogabassey cart link.
export function buildReviewCartUrl(cartUrl: string): string | null {
  const url = new URL(cartUrl);
  if (
    url.origin !== 'https://ogabassey.com' ||
    url.pathname !== '/cart' ||
    url.username ||
    url.password
  )
    return null;
  const guestCart = url.searchParams.get('guest_cart');
  const review = new URL('https://ogabassey.com/cart');
  if (guestCart && parseHandoffLines(guestCart))
    review.searchParams.set('guest_cart', guestCart);
  return review.toString();
}
