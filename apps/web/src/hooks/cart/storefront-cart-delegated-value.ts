import type { CartContextType } from './cart-types';
import type { UseSharedCartResult } from './use-shared-cart';

/** Map the shared-cart result onto the delegated context fields. */
export function delegatedCartValue(
  delegated: boolean,
  shared: UseSharedCartResult
): Partial<CartContextType> {
  if (!delegated) return {};
  return {
    syncStatus: shared.syncStatus,
    syncError: shared.syncError,
    retryPendingSync: shared.retryPendingSync,
    importConflicts: shared.importConflicts,
    importWarnings: shared.importWarnings,
    importStatus: shared.importStatus,
    discardLegacyImport: shared.discardLegacyImport,
    resolveImportConflicts: shared.resolveImportConflicts,
    sharedCartRef:
      shared.cartId && shared.version !== null && !shared.isTerminal
        ? { cartId: shared.cartId, version: shared.version }
        : null,
    refreshSharedCart: shared.refreshSharedCart,
  };
}
