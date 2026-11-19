import { type CartItemIdentity, cartLineIdentity } from '@baci/shared/cart';
import { intentIdentity } from './shared-cart-display';
import type {
  SharedCartPendingEntry,
  SharedCartState,
} from './shared-cart-state';
/**
 * Drops the optimistic assurance overlay for a line whose
 * set_assurance command reached a terminal outcome: on success the
 * adopted server snapshot is authoritative, and on definitive failure
 * the display must roll back to that same server value instead of
 * masking it (including later changes from other linked devices).
 */
export function withoutAssuranceOverlay(
  state: SharedCartState,
  entry: SharedCartPendingEntry | undefined
): Record<string, boolean> {
  if (entry?.intent.kind !== 'set_assurance') return state.assuranceOverlays;
  const target = entry.intent.target;
  let key: string | null = null;
  if (target.kind === 'identity') {
    key = target.key;
  } else if (target.kind === 'lineId') {
    const line = state.confirmed?.lines.find(
      (candidate) => candidate.id === target.lineId
    );
    key = line ? cartLineIdentity(line.item) : null;
  } else {
    const addEntry = state.queue.find(
      (candidate) =>
        candidate.intent.kind === 'add' &&
        candidate.intent.tempId === target.tempId
    );
    if (addEntry) {
      key = cartLineIdentity(
        intentIdentity(addEntry.intent) as CartItemIdentity
      );
    }
  }
  if (!key || !(key in state.assuranceOverlays)) return state.assuranceOverlays;
  const next = { ...state.assuranceOverlays };
  delete next[key];
  return next;
}
