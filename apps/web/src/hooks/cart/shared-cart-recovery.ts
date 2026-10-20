'use client';

import { buildImportEntries } from './build-import-entries';

import { getCartFromStorage } from './cart-storage';
import type { createCartProvisioning } from './shared-cart-provisioning';
import { planLegacyImport } from './shared-cart-reducer';
import type { createCartSnapshotActions } from './shared-cart-snapshots';
import type { SharedCartRuntime } from './use-shared-cart-runtime';

export function createCartRecovery(
  context: SharedCartRuntime &
    Pick<ReturnType<typeof createCartProvisioning>, 'ensureCart'> &
    Pick<ReturnType<typeof createCartSnapshotActions>, 'refreshNow'>
) {
  const {
    enabled,
    dispatch,
    stateRef,
    generationRef,
    importOpIdsRef,
    createAttemptedRef,
    createRequestRef,
    bootstrappingRef,
    optionsRef,
    refreshNow,
    ensureCart,
    setLinkPhase,
  } = context;

  function retryPendingSync(): void {
    if (!enabled) return;
    const failed = stateRef.current.queue.find(
      (entry) => entry.state === 'failed'
    );
    if (!failed) {
      if (stateRef.current.importStatus === 'failed') {
        retryImport();
      }
      return;
    }
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
      setLinkPhase('ready');
      return;
    }
    if (!current.confirmed) {
      if (bootstrappingRef.current || createAttemptedRef.current) {
        dispatch({
          generation,
          code: 'temporarily_unavailable',
          type: 'import/failed',
        });
        return;
      }
      // Capacity can be resolved before any server cart or queue exists.
      // Keep the exact provisioning request on retries and fence late replies.
      void ensureCart().then((result) => {
        if (generationRef.current !== generation) return;
        if (!result) {
          dispatch({
            generation,
            code: 'temporarily_unavailable',
            type: 'import/failed',
          });
          return;
        }
        if (!result.ok) {
          dispatch({ generation, code: result.code, type: 'import/failed' });
          return;
        }
        setLinkPhase('ready');
      });
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
    if (planned.kind === 'blocked') {
      dispatch({ generation, type: 'import/capacity_exceeded' });
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
    const entries = buildImportEntries(planned, current.confirmed.cartId);
    if (entries.length === 0) {
      dispatch({ generation, status: 'done', type: 'import/resolved' });
      return;
    }
    importOpIdsRef.current = new Set(entries.map((entry) => entry.operationId));
    dispatch({ entries, generation, type: 'import/enqueue' });
  }
  function discardLegacyImport(): void {
    if (
      !enabled ||
      stateRef.current.importStatus !== 'failed' ||
      bootstrappingRef.current ||
      (!stateRef.current.confirmed &&
        (createAttemptedRef.current ||
          Boolean(createRequestRef.current?.lines)))
    )
      return;
    dispatch({
      generation: generationRef.current,
      status: 'skipped',
      type: 'import/resolved',
    });
    setLinkPhase('ready');
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
    discardLegacyImport,
    resolveImportConflicts,
  };
}
