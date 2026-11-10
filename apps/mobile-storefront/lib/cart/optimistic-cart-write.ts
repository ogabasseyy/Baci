import { isSameCartLine } from '@/stores/cart-line';
import type { CartItem } from '@/stores/cart-store.types';
import type { SharedCartWrite } from '@/stores/shared-cart-writer';

const PENDING = 'pending-line::';

export interface OptimisticCartDeps {
  getItems(): CartItem[];
  setItems(items: CartItem[]): void;
  /** Predict only against a confirmed shared cart, never during creation/migration. */
  hasSnapshot(): boolean;
}

function clampQuantity(item: CartItem, quantity: number): number {
  return item.max_quantity ? Math.min(quantity, item.max_quantity) : quantity;
}

/** What the screen should show right now, or null when only the server can say. */
function predict(
  items: CartItem[],
  action: SharedCartWrite,
  pendingId: string
): CartItem[] | null {
  if (action.type === 'clear') return [];
  if (action.type === 'remove')
    return items.some((item) => item.id === action.id)
      ? items.filter((item) => item.id !== action.id)
      : null;
  if (action.type === 'quantity') {
    if (!items.some((item) => item.id === action.id)) return null;
    if (action.quantity <= 0) return items.filter((i) => i.id !== action.id);
    return items.map((item) =>
      item.id === action.id
        ? { ...item, quantity: clampQuantity(item, action.quantity) }
        : item
    );
  }
  if (action.type === 'add') {
    const incoming = action.item;
    const hasVoucher = Boolean(
      incoming.voucher_token || incoming.voucher_award_id
    );
    const quantity = hasVoucher ? 1 : incoming.quantity;
    const index = items.findIndex((item) => isSameCartLine(item, incoming));
    if (index < 0) return [...items, { ...incoming, quantity, id: pendingId }];
    if (hasVoucher) return items;
    return items.map((item, at) =>
      at === index
        ? { ...item, quantity: clampQuantity(item, item.quantity + quantity) }
        : item
    );
  }
  return null;
}

/**
 * Shows shared-cart edits on screen at once and reconciles with the server
 * reply. Writes still go through the controller one at a time, so receipts,
 * version-conflict retry and checkout fencing are untouched: this only
 * changes what is displayed while a write is in flight.
 */
export function createOptimisticCart(deps: OptimisticCartDeps) {
  const pendingAdds = new Map<string, Omit<CartItem, 'id'>>();
  let tail: Promise<unknown> = Promise.resolve();
  let sequence = 0;
  const nextSequence = () => {
    sequence += 1;
    return sequence;
  };

  function resolveTarget(action: SharedCartWrite): SharedCartWrite {
    if (
      (action.type !== 'remove' && action.type !== 'quantity') ||
      !action.id.startsWith(PENDING)
    )
      return action;
    const added = pendingAdds.get(action.id);
    const real = added
      ? deps
          .getItems()
          .find(
            (item) =>
              !item.id.startsWith(PENDING) && isSameCartLine(item, added)
          )
      : undefined;
    return real ? { ...action, id: real.id } : action;
  }

  function write(
    action: SharedCartWrite,
    exec: (resolved: SharedCartWrite) => Promise<void>
  ): Promise<void> {
    const before = deps.getItems();
    const pendingId = `${PENDING}${nextSequence()}`;
    const after = deps.hasSnapshot()
      ? predict(before, action, pendingId)
      : null;
    if (after) {
      deps.setItems(after);
      if (action.type === 'add') pendingAdds.set(pendingId, action.item);
    }
    const run = tail
      .catch(() => undefined)
      .then(() => exec(resolveTarget(action)))
      .catch((error: unknown) => {
        pendingAdds.delete(pendingId);
        // Restore only when nothing newer was shown; a later server
        // snapshot already reflects the truth and must not be overwritten.
        if (after && deps.getItems() === after) deps.setItems(before);
        throw error;
      })
      .then(() => {
        // Kept past confirmation so a queued edit of the pending line can
        // still be retargeted; bounded so it never grows.
        if (pendingAdds.size > 50)
          pendingAdds.delete(pendingAdds.keys().next().value as string);
      });
    tail = run;
    return run;
  }
  return { write };
}
