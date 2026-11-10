import { isSameCartLine } from '@/stores/cart-line';
import type { CartItem } from '@/stores/cart-store.types';
import type { SharedCartWrite } from '@/stores/shared-cart-writer';

const PENDING = 'pending-line::';

const noop = (): void => undefined;

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
  const landed = new Set<PendingEdit>();
  let sequence = 0;
  const addedLines = new Map<string, Omit<CartItem, 'id'>>();
  const pinned = new Map<string, number>();
  let running: PendingEdit | null = null;

  /** The real line a pending id stands for, once the add has landed in `items`. */
  const realId = (items: CartItem[], id: string) => {
    const added = addedLines.get(id);
    return added
      ? items.find(
          (item) => !isPendingLineId(item.id) && isSameCartLine(item, added)
        )?.id
      : undefined;
  };
  const view = (skipRunning = false) =>
    edits.reduce((items, edit) => {
      if (landed.has(edit) || (skipRunning && edit === running)) return items;
      const { action } = edit;
      const target =
        (action.type === 'remove' || action.type === 'quantity') &&
        isPendingLineId(action.id)
          ? { ...action, id: realId(items, action.id) ?? action.id }
          : action;
      return predict(items, target, edit.pendingId) ?? items;
    }, confirmed);

  return {
    /** Server-confirmed lines arrived; returns what to display with waiting edits on top. */
    confirm(items: CartItem[]): CartItem[] {
      confirmed = items;
      // The edit being sent is in the reply it just produced; replaying it would double it.
      return view(true);
    },
    /** A finished or discarded cart leaves nothing to predict against. */
    reset(items: CartItem[] = []): void {
      confirmed = items;
      edits = [];
      running = null;
      landed.clear();
    },
    /** Keeps a pending line's identity while an unpredicted tap (assurance, negotiation) waits on it. */
    pin(action: SharedCartWrite): () => void {
      if (!('id' in action) || !isPendingLineId(action.id)) return noop;
      const { id } = action;
      pinned.set(id, (pinned.get(id) ?? 0) + 1);
      return () => {
        const left = (pinned.get(id) ?? 1) - 1;
        if (left > 0) pinned.set(id, left);
        else pinned.delete(id);
      };
    },
    /** Server-confirmed lines when edits are still waiting, else null (nothing to undo). */
    revert(): CartItem[] | null {
      return edits.length ? confirmed : null;
    },
    begin(action: SharedCartWrite): PendingEdit {
      sequence += 1;
      const edit = { action, pendingId: `${PENDING}${sequence}` };
      edits.push(edit);
      if (action.type === 'add') {
        addedLines.set(edit.pendingId, action.item);
      }
      show(view());
      return edit;
    },
    /** The server may already hold this edit; stop replaying it over snapshots that include it. */
    startRun(edit: PendingEdit): void {
      running = edit;
    },
    markLanded(edit: PendingEdit): void {
      landed.add(edit);
    },
    settle(edit: PendingEdit): void {
      landed.delete(edit);
      if (running === edit) running = null;
      edits = edits.filter((entry) => entry !== edit);
      // Keep an added line's identity only while an edit still needs it.
      for (const id of [...addedLines.keys()])
        if (
          !pinned.has(id) &&
          !edits.some(
            (entry) =>
              entry.pendingId === id ||
              (entry.action.type !== 'add' &&
                'id' in entry.action &&
                entry.action.id === id)
          )
        )
          addedLines.delete(id);
      show(view());
    },
    /**
     * Turns a tap on a not-yet-confirmed line into one on the real line.
     * Null means that line never reached the cart, so there is nothing to send.
     */
    resolve(action: SharedCartWrite): SharedCartWrite | null {
      if (!('id' in action) || !isPendingLineId(action.id)) return action;
      const real = realId(confirmed, action.id);
      return real ? { ...action, id: real } : null;
    },
  };
}
