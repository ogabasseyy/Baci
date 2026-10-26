import type { PairingSyncOperations } from './pairing-sync-operations';

/**
 * A read-only refresh cannot create a missing canonical cart, and prepare
 * is a no-op once a snapshot exists, so each state has exactly one useful
 * retry operation (or none, when that operation is unbound).
 */
export function pairingRetryOperation(
  shared: PairingSyncOperations,
  itemCount: number
): (() => Promise<void>) | null {
  if (shared.snapshot) return shared.refresh;
  if (itemCount === 0) return shared.refresh;
  return shared.prepare ?? shared.refresh;
}
