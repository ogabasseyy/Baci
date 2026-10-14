'use client';

import type { Product } from '@/lib/products';

import { getCartFromStorage } from './cart-storage';

import { planLegacyImport } from './shared-cart-reducer';
import type { createCartSnapshotActions } from './shared-cart-snapshots';
import type { SharedCartRuntime } from './use-shared-cart-runtime';

export function createCartRecovery(
  context: SharedCartRuntime &
    Pick<ReturnType<typeof createCartSnapshotActions>, 'refreshNow'>
) {
  const {
    enabled,
    dispatch,
    stateRef,
    generationRef,
    importOpIdsRef,
    createAttemptedRef,
    optionsRef,
    refreshNow,
  } = context;

  function retryPendingSync(): void {
    if (!enabled) return;
    const failed = stateRef.current.queue.find(
      (entry) => entry.state === 'failed'
    );
    if (!failed) return;
    dispatch({
      generation: generationRef.current,
      operationId: failed.operationId,
      type: 'command/retry',
    });
  }

  function refreshSharedCart(): Promise<void> {
    // Explicit stale-review refresh: bypass coalescing and visibility
    // guards so the next submit sees the live version. Adoption and
    // generation guards still apply.
    return refreshNow(true);
  }

  function retryImport(
    resolutions: import('@baci/shared/cart').CartMergeResolution[] = []
  ): void {
    if (!enabled) return;
    const generation = generationRef.current;
    const current = stateRef.current;
    if (current.importStatus !== 'failed') return;
    const cached = getCartFromStorage(optionsRef.current.merchantSlug);
    if (cached.length === 0) {
      dispatch({ generation, status: 'skipped', type: 'import/resolved' });
      return;
    }
    if (!current.confirmed) {
      createAttemptedRef.current = false;
      retryPendingSync();
      return;
    }
    const planned = planLegacyImport(
      cached,
      current.confirmed,
      current.confirmed.cartId,
      resolutions
    );
    if (planned.kind === 'nothing') {
      dispatch({ generation, status: 'skipped', type: 'import/resolved' });
      return;
    }
    if (planned.kind === 'conflicts') {
      dispatch({
        conflicts: planned.conflicts,
        generation,
        type: 'import/conflicts',
      });
      return;
    }
    if (planned.kind === 'create') return;
    dispatch({
      generation,
      type: 'import/started',
      warnings: planned.warnings,
    });
    const entries = [
      ...planned.adds.map((add) => ({
        intent: {
          input: add.line,
          kind: 'add' as const,
          product: {} as Product,
          quantity: add.line.quantity,
          tempId: `imp-${add.operationId.slice(-8)}`,
        },
        operationId: add.operationId,
      })),
      ...planned.sets.map((set, index) => ({
        intent: {
          kind: 'set_quantity' as const,
          quantity: set.quantity,
          target: { kind: 'lineId' as const, lineId: set.lineId },
        },
        operationId: `import:${current.confirmed?.cartId}:set:${set.lineId}:${index}`,
      })),
    ];
    importOpIdsRef.current = new Set(entries.map((entry) => entry.operationId));
    dispatch({ entries, generation, type: 'import/enqueue' });
  }
  function resolveImportConflicts(
    resolutions: import('@baci/shared/cart').CartMergeResolution[]
  ): void {
    retryImport(resolutions);
  }
  return {
    retryPendingSync,
    refreshSharedCart,
    retryImport,
    resolveImportConflicts,
  };
}
