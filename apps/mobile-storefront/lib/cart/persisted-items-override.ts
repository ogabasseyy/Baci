import type { CartItem } from '@/stores/cart-store.types';

let source: (() => CartItem[] | null) | null = null;

/** Server-confirmed lines to save instead of the screen while edits wait, else null. */
export function persistedItemsOverride(): CartItem[] | null {
  return source?.() ?? null;
}

/** Lets the active shared-cart controller keep unconfirmed predictions off disk. */
export function bindPersistedItemsOverride(
  next: () => CartItem[] | null
): () => void {
  source = next;
  return () => {
    if (source === next) source = null;
  };
}
