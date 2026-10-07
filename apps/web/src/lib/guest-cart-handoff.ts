import { guestCartHandoffSchema } from '@/schemas/mcp-guest-cart';

export function parseGuestCartHandoff(raw: string | null) {
  if (!raw || raw.length > 4000) return null;
  try {
    const result = guestCartHandoffSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export interface GuestCartTransfer {
  itemIds: string;
  quantities: Map<string, number>;
}

/** Parses the `guest_cart` URL value into website transfer inputs. */
export function resolveGuestCartTransfer(
  raw: string | null
): GuestCartTransfer | null {
  const items = parseGuestCartHandoff(raw);
  if (!items) return null;
  return {
    itemIds: items.map((item) => item.product_id).join(','),
    quantities: new Map(
      items.map((item) => [item.product_id, item.quantity] as const)
    ),
  };
}

/**
 * Additive-only transfer: tops a website line up to the handoff target but
 * never shrinks or deletes it, so chat-side removals or quantity decreases
 * do not propagate to an already-transferred website cart.
 */
export function resolveGuestQuantityToAdd(
  target: number | undefined,
  existing: number,
  fallback: number
): number {
  if (target === undefined) return fallback;
  return Math.max(0, target - existing);
}

/**
 * Rewrites a processed cart-link URL, keeping only retryable stock failures
 * in the handoff params and always consuming one-shot link params.
 */
export function rewriteCartLinkUrl(
  href: string,
  guestQuantities: Map<string, number> | undefined,
  rejectedIds: string[]
): string {
  const url = new URL(href);
  if (guestQuantities && rejectedIds.length > 0) {
    url.searchParams.set(
      'guest_cart',
      JSON.stringify(
        rejectedIds.map((product_id) => ({
          product_id,
          quantity: guestQuantities.get(product_id),
        }))
      )
    );
    url.searchParams.delete('item_id');
    url.searchParams.delete('qty');
  } else if (rejectedIds.length > 0) {
    url.searchParams.set('item_id', rejectedIds.join(','));
  } else {
    url.searchParams.delete('item_id');
    url.searchParams.delete('qty');
  }
  if (guestQuantities && rejectedIds.length === 0)
    url.searchParams.delete('guest_cart');
  url.searchParams.delete('quiz_award_id');
  url.searchParams.delete('quiz_voucher_token');
  url.searchParams.delete('variant_id');
  url.searchParams.delete('condition');
  return `${url.pathname}${url.search}${url.hash}`;
}
