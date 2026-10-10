import type { CartItem, WidgetState } from './widget-types';

/**
 * Reconciles displayed lines with a server response: another widget or a
 * direct tool call may have changed sibling lines under the token, so keep
 * only lines the server still holds (minus the just-handled product) and
 * take the server quantities. Shared by the add and remove merges.
 */
export function reconcileCartLineQuantities(
  previousCart: CartItem[] | undefined,
  quantities: ReadonlyMap<string, number>,
  excludeId: string
): CartItem[] {
  return (previousCart ?? [])
    .filter(
      (item) =>
        item.product.id !== excludeId && quantities.has(item.product.id)
    )
    .map((item) => ({
      ...item,
      quantity: quantities.get(item.product.id) ?? item.quantity,
    }));
}

/**
 * Drops one line from persisted widget state without a server round trip and
 * rebuilds the handoff URL from the survivors, so Review transfers exactly
 * what the widget still shows. Used for legacy tokenless state and for
 * removals against an expired server cart (the dead token is forgotten).
 */
export function dropLineFromCartState(
  previous: WidgetState | null,
  productId: string
): WidgetState {
  const survivors = (previous?.cart ?? []).filter(
    (item) => item.product.id !== productId
  );
  const review = new URL('https://ogabassey.com/cart');
  if (survivors.length > 0)
    review.searchParams.set(
      'guest_cart',
      JSON.stringify(
        survivors.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
        }))
      )
    );
  return {
    ...previous!,
    cart: survivors,
    cartUrl: survivors.length > 0 ? review.toString() : undefined,
    cartToken: undefined,
  };
}
