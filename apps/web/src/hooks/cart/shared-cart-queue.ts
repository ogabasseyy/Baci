import type { CartSnapshot } from '@baci/shared/cart';
import { deriveDisplay } from './shared-cart-display';
import type {
  SharedCartIntent,
  SharedCartPendingEntry,
  SharedCartState,
} from './shared-cart-state';

export function withDisplay(state: SharedCartState): SharedCartState {
  return { ...state, display: deriveDisplay(state) };
}

/**
 * Adopts a snapshot only when it belongs to this merchant and is not
 * older than the confirmed state. Equal versions adopt idempotently;
 * lower versions are rejected so an old replay never overwrites newer
 * state within a generation.
 */
export function adoptSnapshot(
  state: SharedCartState,
  snapshot: CartSnapshot
): SharedCartState {
  if (snapshot.merchantId !== state.merchantId) return state;
  const current = state.confirmed?.version ?? -1;
  if (snapshot.version < current) return state;
  return { ...state, cartId: snapshot.cartId, confirmed: snapshot };
}

export function tempsCreatedBy(entry: SharedCartPendingEntry): string[] {
  return entry.intent.kind === 'add' ? [entry.intent.tempId] : [];
}

/**
 * Drops entries and transitively drops anything blocked on a temp that
 * will now never resolve. Returns the surviving queue plus every temp
 * that lost its provider.
 */
export function dropEntriesAndCascade(
  queue: SharedCartPendingEntry[],
  operationIds: Set<string>
): { queue: SharedCartPendingEntry[]; droppedTemps: string[] } {
  const dropped = new Set(operationIds);
  const droppedTemps = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of queue) {
      if (dropped.has(entry.operationId)) {
        for (const tempId of tempsCreatedBy(entry)) {
          if (!droppedTemps.has(tempId)) {
            droppedTemps.add(tempId);
            grew = true;
          }
        }
      } else if (
        entry.blockedOnTempId !== undefined &&
        droppedTemps.has(entry.blockedOnTempId)
      ) {
        dropped.add(entry.operationId);
        grew = true;
      }
    }
  }
  return {
    droppedTemps: [...droppedTemps],
    queue: queue.filter((entry) => !dropped.has(entry.operationId)),
  };
}

export function resolveTempDependents(
  queue: SharedCartPendingEntry[],
  tempId: string,
  lineId: string | null
): SharedCartPendingEntry[] {
  if (lineId === null) {
    const blocked = new Set(
      queue
        .filter((entry) => entry.blockedOnTempId === tempId)
        .map((entry) => entry.operationId)
    );
    return dropEntriesAndCascade(queue, blocked).queue;
  }
  return queue.map((entry) => {
    if (entry.blockedOnTempId !== tempId) return entry;
    const intent = entry.intent;
    const next: SharedCartPendingEntry = { ...entry };
    delete next.blockedOnTempId;
    if (
      (intent.kind === 'set_quantity' || intent.kind === 'remove') &&
      intent.target.kind === 'temp' &&
      intent.target.tempId === tempId
    ) {
      next.intent = {
        ...intent,
        target: { kind: 'lineId', lineId },
      } as SharedCartPendingEntry['intent'];
    }
    return next;
  });
}

export function targetTempId(intent: SharedCartIntent): string | undefined {
  if (intent.kind === 'set_quantity' || intent.kind === 'remove') {
    return intent.target.kind === 'temp' ? intent.target.tempId : undefined;
  }
  return undefined;
}
