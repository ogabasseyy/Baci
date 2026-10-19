import {
  hasNotedPendingVtuReferenceIn,
  listNotedPendingVtuReferencesFrom,
} from './utility-pending-vtu-reference-queries';
import {
  pendingVtuPurchases,
  schedulePendingVtuFlush,
  syncPendingVtuPurchasesFromSnapshot,
} from './utility-pending-vtu-sync';

/**
 * Reference tracking for the web pending-VTU registry (Codex R137
 * P1 split — the registry exceeded the 300-line ceiling): noting a
 * provider reference onto a retained entry, probing noted
 * references, and listing them. Pure queries/mutations over the
 * shared module map; re-exported by utility-pending-idempotency.
 */
export function notePendingVtuReference(
  payloadSignature: string,
  reference: string
): void {
  const pending = pendingVtuPurchases.get(payloadSignature);
  if (pending) {
    pending.reference = reference;
    schedulePendingVtuFlush();
  }
}

export function hasNotedPendingVtuReference(
  payloadSignature: string,
  reference: string
): boolean {
  return hasNotedPendingVtuReferenceIn(
    pendingVtuPurchases,
    payloadSignature,
    reference
  );
}

export function listNotedPendingVtuReferences(scopeTag?: string): string[] {
  syncPendingVtuPurchasesFromSnapshot();
  return listNotedPendingVtuReferencesFrom(
    pendingVtuPurchases.values(),
    scopeTag
  );
}
