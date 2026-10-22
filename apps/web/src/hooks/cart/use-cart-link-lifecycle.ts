'use client';

import type { CartSnapshot } from '@baci/shared/cart';
import { startTransition, useEffect } from 'react';
import { buildImportEntries } from './build-import-entries';
import { getCartFromStorage, getSharedCartImportReceipt } from './cart-storage';
import type { CartItem } from './cart-types';
import { fetchSharedCartSnapshot } from './shared-cart-client';
import {
  ADOPT_RETRY_BASE_MS,
  backoffMs,
  FALLBACK_POLL_MS,
  jittered,
  RECONCILE_POLL_MS,
  seedProducts,
} from './shared-cart-hook-support';
import { isTerminalCart } from './shared-cart-queue';
import { planLegacyImport } from './shared-cart-reducer';
import {
  ensureCartDeviceRevocationCleared,
  markCartDeviceSessionActive,
  retireDeEnrolledCartDeviceSession,
} from './shared-cart-session-revoke-client';
import type { createCartSnapshotActions } from './shared-cart-snapshots';
import type { SharedCartRuntime } from './use-shared-cart-runtime';

export function useCartLinkLifecycle(
  context: SharedCartRuntime &
    Pick<
      ReturnType<typeof createCartSnapshotActions>,
      'hydrateMissing' | 'refreshNow'
    >
) {
  const {
    merchantId,
    merchantSlug,
    sessionGeneration,
    enabled,
    realtimeConnected,
    surfaceActive,
    state,
    dispatch,
    hydrated,
    setHydrated,
    setLinkPhase,
    stateRef,
    generationRef,
    adoptOutcomeRef,
    importOpIdsRef,
    createOpRef,
    createRequestRef,
    createAttemptedRef,
    bootstrappingRef,
    lastFetchRef,
    hydratingRef,
    pendingHydrationRef,
    latestSnapshotRef,
    linkRunRef,
    optionsRef,
    hydrateMissing,
    refreshNow,
  } = context;

  // Link lifecycle: seed from the display cache, then adopt. Every async
  // step checks its generation so a merchant switch or logout fences
  // late completions even before the reducer sees them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hydrateMissing closes over refs and stable dispatch only; listing it would relink every render.
  useEffect(() => {
    linkRunRef.current += 1;
    // Only first-mount display-cache restoration may wait for hydration.
    // Later merchant/session changes must retain their urgent authority fence.
    const restoreInitialDisplay = (update: () => void) => {
      if (hydrated) update();
      else startTransition(update);
    };
    if (!enabled) {
      retireDeEnrolledCartDeviceSession?.(merchantSlug, {
        hasCartId: stateRef.current.cartId !== null,
        hasImportReceipt: getSharedCartImportReceipt(merchantSlug) !== null,
      });
      restoreInitialDisplay(() => {
        setHydrated(true);
        setLinkPhase('ready');
      });
      return;
    }
    if (merchantSlug) markCartDeviceSessionActive?.(merchantSlug);
    const generation = sessionGeneration;
    let cancelled = false;
    let adoptTimer: ReturnType<typeof setTimeout> | null = null;
    let removeVisibilityWaiter: (() => void) | null = null;
    adoptOutcomeRef.current = 'unknown';
    importOpIdsRef.current = new Set();
    createOpRef.current = null;
    createRequestRef.current = null;
    createAttemptedRef.current = false;
    bootstrappingRef.current = false;
    // A restarted link owns its hydration loop: the previous run's loop
    // exits on the run check, and clearing both fields lets this run
    // start its own instead of stranding ids behind a stale flag.
    hydratingRef.current = false;
    pendingHydrationRef.current = new Set();
    latestSnapshotRef.current = null;
    const cached = getCartFromStorage(merchantSlug);
    restoreInitialDisplay(() => {
      setLinkPhase('adopting');
      dispatch({
        cached,
        generation,
        merchantId,
        products: seedProducts(cached),
        type: 'link/start',
      });
      setHydrated(true);
    });

    async function adopt(attempt: number): Promise<void> {
      if (cancelled || generationRef.current !== generation) return;
      if (document.hidden) {
        // A background tab or prerender must not link yet — but it must
        // not strand the link either. Wait for the first foreground
        // presentation, then adopt with the same attempt number.
        removeVisibilityWaiter?.();
        const onVisible = () => {
          if (document.hidden) return;
          document.removeEventListener('visibilitychange', onVisible);
          removeVisibilityWaiter = null;
          void adopt(attempt);
        };
        removeVisibilityWaiter = () =>
          document.removeEventListener('visibilitychange', onVisible);
        document.addEventListener('visibilitychange', onVisible);
        return;
      }
      if (
        (await ensureCartDeviceRevocationCleared?.(
          optionsRef.current.merchantSlug
        )) === false
      ) {
        if (cancelled || generationRef.current !== generation) return;
        adoptTimer = setTimeout(
          () => void adopt(attempt + 1),
          backoffMs(ADOPT_RETRY_BASE_MS, attempt)
        );
        return;
      }
      const result = await fetchSharedCartSnapshot(
        undefined,
        optionsRef.current.merchantSlug
      );
      if (cancelled || generationRef.current !== generation) return;
      if (result.ok) {
        adoptOutcomeRef.current = 'session';
        lastFetchRef.current = Date.now();
        dispatch({
          generation,
          snapshot: result.snapshot,
          type: 'link/snapshot',
        });
        setLinkPhase('ready');
        void hydrateMissing(result.snapshot);
        if (!isTerminalCart(result.snapshot))
          void maybeImport(result.snapshot, cached);
        return;
      }
      if (result.retryable) {
        adoptTimer = setTimeout(
          () => void adopt(attempt + 1),
          backoffMs(ADOPT_RETRY_BASE_MS, attempt)
        );
        return;
      }
      adoptOutcomeRef.current =
        result.code === 'not_found' ? 'bootstrap' : 'none';
      if (cached.length === 0) {
        dispatch({ generation, status: 'skipped', type: 'import/resolved' });
      }
      setLinkPhase('ready');
    }

    function maybeImport(snapshot: CartSnapshot, cached: CartItem[]): void {
      if (cancelled || generationRef.current !== generation) return;
      if (stateRef.current.importStatus !== 'none') return;
      const receipt = getSharedCartImportReceipt(merchantSlug);
      if (receipt?.cartId === snapshot.cartId) {
        dispatch({ generation, status: 'done', type: 'import/resolved' });
        return;
      }
      if (cached.length === 0) {
        dispatch({ generation, status: 'skipped', type: 'import/resolved' });
        return;
      }
      const planned = planLegacyImport(cached, snapshot, snapshot.cartId);
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
      if (planned.kind === 'create') {
        // No server cart exists yet: the first sender pass creates with
        // these lines instead of queueing per-line adds.
        dispatch({
          generation,
          type: 'import/started',
          warnings: planned.warnings,
        });
        importOpIdsRef.current = new Set([planned.operationId]);
        return;
      }
      dispatch({
        generation,
        type: 'import/started',
        warnings: planned.warnings,
      });
      const entries = buildImportEntries(planned, snapshot.cartId);
      if (entries.length === 0) {
        dispatch({ generation, status: 'done', type: 'import/resolved' });
        return;
      }
      importOpIdsRef.current = new Set(
        entries.map((entry) => entry.operationId)
      );
      dispatch({ entries, generation, type: 'import/enqueue' });
    }

    void adopt(0);
    return () => {
      cancelled = true;
      if (adoptTimer) clearTimeout(adoptTimer);
      removeVisibilityWaiter?.();
      linkRunRef.current += 1;
    };
  }, [enabled, merchantId, merchantSlug, sessionGeneration]);

  // Convergence polling: fast fallback while realtime is unavailable,
  // slow reconciliation once Task 8 connects. Stops when hidden,
  // inactive, disabled, or unlinked.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hydrateMissing closes over refs and stable dispatch only; listing it would restart polling every render.
  useEffect(() => {
    if (!enabled || !state.cartId || surfaceActive === false) return;
    const generation = sessionGeneration;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const baseMs = realtimeConnected ? RECONCILE_POLL_MS : FALLBACK_POLL_MS;
    const schedule = () => {
      timer = setTimeout(() => void tick(), jittered(baseMs));
    };
    const tick = async () => {
      if (stopped || generationRef.current !== generation) return;
      if (!document.hidden) {
        const result = await fetchSharedCartSnapshot(
          undefined,
          optionsRef.current.merchantSlug
        );
        if (!stopped && generationRef.current === generation && result.ok) {
          lastFetchRef.current = Date.now();
          dispatch({
            generation,
            snapshot: result.snapshot,
            type: 'snapshot/polled',
          });
          void hydrateMissing(result.snapshot);
        }
      }
      schedule();
    };
    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    enabled,
    realtimeConnected,
    sessionGeneration,
    state.cartId,
    surfaceActive,
  ]);

  // Foreground and focus refetch, coalesced with recent reads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshNow is ref-stable and reads the live generation; re-subscribing per generation is unnecessary.
  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (!document.hidden) void refreshNow();
    };
    const onFocus = () => void refreshNow();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled]);
  return {};
}
