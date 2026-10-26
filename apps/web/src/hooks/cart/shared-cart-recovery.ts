'use client';

import { buildImportEntries } from './build-import-entries';

import {
  rotateCartCookieEpoch,
  withCartCookieWrite,
} from './cart-cross-tab-lock';
import { getCartFromStorage, saveCartToStorage } from './cart-storage';
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
    if (
      context.adoptOutcomeRef.current === 'unknown' &&
      context.retryLinkRef.current
    ) {
      if (failed)
        dispatch({
          generation: generationRef.current,
          operationId: failed.operationId,
          type: 'command/retry',
        });
      context.retryLinkRef.current();
      return;
    }
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
    if (
      context.adoptOutcomeRef.current === 'unknown' &&
      context.retryLinkRef.current
    ) {
      context.retryLinkRef.current();
      return;
    }
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
    if (context.importSourceIdsRef)
      context.importSourceIdsRef.current = cached
        .map((item) => ({
          cartItemId: item.cartItemId,
          quantity: item.quantity,
        }))
        .filter((line) => Boolean(line.cartItemId));
    dispatch({ entries, generation, type: 'import/enqueue' });
  }
  function discardLegacyImport(): void {
    if (
      !enabled ||
      stateRef.current.importStatus !== 'failed' ||
      bootstrappingRef.current
    )
      return;
    const capacityBlocked =
      stateRef.current.importWarnings?.includes('import_capacity_exceeded') ??
      false;
    if (
      !stateRef.current.confirmed &&
      (createAttemptedRef.current ||
        Boolean(createRequestRef.current?.lines)) &&
      !capacityBlocked
    )
      return;
    // The shopper explicitly abandons the retained device cart, so the
    // indeterminate create that carried it must not replay afterwards.
    // Keep a copy until the erasure below is verified: a failed write
    // restores the exact create request so retry stays replay-safe.
    let discardedCreate: {
      attempted: boolean;
      request: typeof createRequestRef.current;
    } | null = null;
    if (!stateRef.current.confirmed && capacityBlocked) {
      discardedCreate = {
        attempted: createAttemptedRef.current,
        request: createRequestRef.current,
      };
      createAttemptedRef.current = false;
      createRequestRef.current = null;
    }
    const restoreDiscardedCreate = () => {
      if (!discardedCreate) return;
      createAttemptedRef.current = discardedCreate.attempted;
      createRequestRef.current = discardedCreate.request;
    };
    // Discarding explicitly abandons the device lines: erase the parked
    // cache so a later terminal guard or re-plan cannot resurrect them.
    // The display cache re-persists the kept server cart afterwards.
    // Serialize with in-flight creates in other tabs and rotate the
    // epoch so a cloned pre-discard request is fenced, then verify the
    // erasure persisted before resolving the import as skipped.
    const merchantSlug = optionsRef.current.merchantSlug;
    const generation = generationRef.current;
    const signal =
      typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(5_000)
        : new AbortController().signal;
    let write: Promise<unknown>;
    try {
      write = withCartCookieWrite(
        undefined,
        signal,
        () => {
          rotateCartCookieEpoch(merchantSlug);
          saveCartToStorage([], merchantSlug);
          return Promise.resolve(undefined);
        },
        merchantSlug
      );
    } catch {
      // A secure browser without Web Locks throws synchronously from
      // the lock manager: keep the capacity recovery active.
      restoreDiscardedCreate();
      dispatch({
        code: 'temporarily_unavailable',
        generation,
        type: 'import/failed',
      });
      return;
    }
    void write
      .then(() => {
        if (generationRef.current !== generation) return;
        if (getCartFromStorage(merchantSlug).length === 0) {
          dispatch({ generation, status: 'skipped', type: 'import/resolved' });
          setLinkPhase('ready');
          return;
        }
        restoreDiscardedCreate();
        dispatch({
          code: 'temporarily_unavailable',
          generation,
          type: 'import/failed',
        });
      })
      .catch(() => {
        if (generationRef.current !== generation) return;
        restoreDiscardedCreate();
        dispatch({
          code: 'temporarily_unavailable',
          generation,
          type: 'import/failed',
        });
      });
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
