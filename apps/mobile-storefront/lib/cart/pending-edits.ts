import { isSameCartLine } from '@/stores/cart-line';
import type { CartItem } from '@/stores/cart-store.types';
import type { SharedCartWrite } from '@/stores/shared-cart-writer';

const PENDING = 'pending-line::';
const MAX_REMEMBERED_ADDS = 50;

export const isPendingLineId = (id: string) => id.startsWith(PENDING);

export interface PendingEdit {
  action: SharedCartWrite;
  pendingId: string;
}

/** Edits the screen can predict; everything else waits for the server. */
export function isPredictableEdit(action: SharedCartWrite): boolean {
  return (
    action.type === 'add' ||
    action.type === 'remove' ||
    action.type === 'quantity' ||
    action.type === 'clear'
  );
}

function clampQuantity(item: CartItem, quantity: number): number {
  return item.max_quantity ? Math.min(quantity, item.max_quantity) : quantity;
}

/** What the screen should show after one more edit, or null when only the server can say. */
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
 * The cart the server last confirmed plus the edits still waiting to be
 * confirmed. The screen always shows `confirmed` with the waiting edits
 * replayed on top, so a server refresh never drops a queued tap and a failed
 * edit disappears without disturbing the others.
 */
export function createPendingEdits(show: (items: CartItem[]) => void) {
  let confirmed: CartItem[] = [];
  let edits: PendingEdit[] = [];
  let sequence = 0;
  const addedLines = new Map<string, Omit<CartItem, 'id'>>();

  const view = () =>
    edits.reduce(
      (items, edit) => predict(items, edit.action, edit.pendingId) ?? items,
      confirmed
    );

  return {
    /** Server-confirmed lines arrived; returns what to display with waiting edits on top. */
    confirm(items: CartItem[]): CartItem[] {
      confirmed = items;
      return view();
    },
    /** A finished or discarded cart leaves nothing to predict against. */
    reset(items: CartItem[] = []): void {
      confirmed = items;
      edits = [];
    },
    begin(action: SharedCartWrite): PendingEdit {
      sequence += 1;
      const edit = { action, pendingId: `${PENDING}${sequence}` };
      edits.push(edit);
      if (action.type === 'add') {
        addedLines.set(edit.pendingId, action.item);
        if (addedLines.size > MAX_REMEMBERED_ADDS) {
          const oldest = addedLines.keys().next();
          if (!oldest.done) addedLines.delete(oldest.value);
        }
      }
      show(view());
      return edit;
    },
    settle(edit: PendingEdit): void {
      edits = edits.filter((entry) => entry !== edit);
      show(view());
    },
    /**
     * Turns a tap on a not-yet-confirmed line into one on the real line.
     * Null means that line never reached the cart, so there is nothing to send.
     */
    resolve(action: SharedCartWrite): SharedCartWrite | null {
      if (
        (action.type !== 'remove' && action.type !== 'quantity') ||
        !isPendingLineId(action.id)
      )
        return action;
      const added = addedLines.get(action.id);
      const real = added
        ? confirmed.find((item) => isSameCartLine(item, added))
        : undefined;
      return real ? { ...action, id: real.id } : null;
    },
  };
}
