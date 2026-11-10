import type { CartItem } from '@/stores/cart-store.types';

const PENDING = 'pending-line::';

export const pendingLineId = (sequence: number) => `${PENDING}${sequence}`;
export const isPendingLineId = (id: string) => id.startsWith(PENDING);

/** Predicted lines are screen-only: never persisted, imported or counted as the shopper's own. */
export const stripPendingLines = (items: CartItem[]): CartItem[] =>
  items.some((item) => isPendingLineId(item.id))
    ? items.filter((item) => !isPendingLineId(item.id))
    : items;

/** Wraps a legacy-cart reader so the controller never sees predicted lines. */
export function withoutPendingLines<T extends { items: CartItem[] }>(
  read: () => T
): () => T {
  return () => {
    const legacy = read();
    return { ...legacy, items: stripPendingLines(legacy.items) };
  };
}
