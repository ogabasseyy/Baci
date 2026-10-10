import {
  parseHandoffLines,
  type HandoffLine,
} from './parse-handoff-lines';
import type { parseCartToolOutput } from './parse-cart-tool-output';

type RemovalContent = ReturnType<typeof parseCartToolOutput>;

/**
 * Validates a removal response and parses its surviving lines: the token
 * must still match, the URL must be a usable Ogabassey cart link, and the
 * removed line must actually be gone. Returns null when the response is
 * unusable (the caller fails the removal); throws on a malformed URL
 * exactly like the inline version did. Split from use-cart-handoff to
 * hold the 300-line file budget.
 */
export function parseRemovalRemaining(
  content: RemovalContent,
  cartToken: string,
  productId: string
): HandoffLine[] | null {
  const url = content?.cart_url ? new URL(content.cart_url) : null;
  const raw = url?.searchParams.get('guest_cart') ?? null;
  // An emptied cart arrives as a bare /cart URL (legacy responses
  // carry guest_cart=[]); both mean no lines remain.
  const remaining =
    raw === null || raw === '[]' ? [] : parseHandoffLines(raw);
  if (
    !content?.success ||
    content.cart_token !== cartToken ||
    url?.origin !== 'https://ogabassey.com' ||
    url.pathname !== '/cart' ||
    url.username ||
    url.password ||
    !remaining ||
    remaining.some((line) => line.product_id === productId)
  )
    return null;
  return remaining;
}
