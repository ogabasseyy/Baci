type CancellationState = 'pending' | 'uncertain' | 'resolved';

// Keep unresolved writes in memory even when a chat message or widget unmounts.
// Keys contain only the storefront slug and an order ID already returned by the
// authenticated order endpoint; no order content or customer details are retained.
const states = new Map<string, CancellationState>();
const listeners = new Set<() => void>();
let revision = 0;
const key = (merchant: string, order: string) => `${merchant}:${order}`;

function notify() {
  revision += 1;
  for (const listener of listeners) listener();
}

export function subscribeChatCancellations(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function chatCancellationRevision() {
  return revision;
}
export function chatCancellationState(merchant: string, order: string) {
  return states.get(key(merchant, order));
}

export function startChatCancellation(
  merchant: string,
  order: string
): boolean {
  const id = key(merchant, order);
  if (states.has(id)) return false;
  states.set(id, 'pending');
  notify();
  return true;
}

export function finishChatCancellation(
  merchant: string,
  order: string,
  confirmed: boolean
) {
  const id = key(merchant, order);
  if (states.get(id) !== 'pending') return;
  states.set(id, confirmed ? 'resolved' : 'uncertain');
  notify();
}

export function reconcileChatCancellations(
  merchant: string,
  orders: ReadonlyArray<{ id: string; shipping_status: string | null }>
) {
  let changed = false;
  for (const order of orders) {
    const id = key(merchant, order.id);
    if (
      order.shipping_status === 'cancelled' &&
      states.get(id) === 'uncertain'
    ) {
      states.set(id, 'resolved');
      changed = true;
    }
  }
  if (changed) notify();
}

export function resetChatCancellationStateForTests() {
  states.clear();
  notify();
}
