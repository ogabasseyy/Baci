'use client';

import { useEffect } from 'react';
import {
  getCartFromStorage,
  getSharedCartImportReceipt,
  saveCartToStorage,
} from './cart-storage';
import { createCartVisibilityWaiter } from './cart-visibility-waiter';
import { fetchSharedCartSnapshot } from './shared-cart-client';
import {
  ADOPT_RETRY_BASE_MS,
  backoffMs,
  MAX_AUTO_RETRIES,
  seedProducts,
} from './shared-cart-hook-support';
import { importInitialDeviceCart } from './shared-cart-initial-import';
import { createInitialCartProvisioner } from './shared-cart-initial-provisioning';
import type { createCartProvisioning } from './shared-cart-provisioning';
import { isTerminalCart } from './shared-cart-queue';
import { planLegacyImport } from './shared-cart-reducer';
import {
  ensureCartDeviceRevocationCleared,
  isCartDeviceRevocationPending,
  markCartDeviceSessionActive,
  retireDeEnrolledCartDeviceSession,
} from './shared-cart-session-revoke-client';
import type { createCartSnapshotActions } from './shared-cart-snapshots';
import { unimportedTerminalLines } from './terminal-cart-cache';
import { useCartLinkPolling } from './use-cart-link-polling';
import type { SharedCartRuntime } from './use-shared-cart-runtime';

export function useCartLinkLifecycle(
  context: SharedCartRuntime &
    Pick<ReturnType<typeof createCartProvisioning>, 'ensureCart'> &
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
    dispatch,
    setHydrated,
    setLinkPhase,
    stateRef,
    generationRef,
    adoptOutcomeRef,
    importOpIdsRef,
    createOpRef,
    createRequestRef,
    createSourceIdsRef,
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

  // Seed the cache, then adopt under a fenced session generation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hydrateMissing closes over refs and stable dispatch only; listing it would relink every render.
  useEffect(() => {
    linkRunRef.current += 1;
    if (!enabled) {
      retireDeEnrolledCartDeviceSession?.(merchantSlug, {
        hasCartId: stateRef.current.cartId !== null,
        hasImportReceipt: getSharedCartImportReceipt(merchantSlug) !== null,
      });
      setHydrated(true);
      setLinkPhase('ready');
      return;
    }
    if (merchantSlug) markCartDeviceSessionActive?.(merchantSlug);
    const generation = sessionGeneration;
    let cancelled = false;
    let adoptRun = 0;
    let adoptTimer: ReturnType<typeof setTimeout> | null = null;
    const visibility = createCartVisibilityWaiter();
    adoptOutcomeRef.current = 'unknown';
    importOpIdsRef.current = new Set();
    createOpRef.current = null;
    createRequestRef.current = null;
    if (createSourceIdsRef) createSourceIdsRef.current = [];
    if (context.importSourceIdsRef) context.importSourceIdsRef.current = [];
    createAttemptedRef.current = false;
    bootstrappingRef.current = false;
    // Reset hydration ownership so a restart cannot inherit stale work.
    hydratingRef.current = false;
    pendingHydrationRef.current = new Set();
    latestSnapshotRef.current = null;
    setLinkPhase('adopting');

    // Preserve the parked cache on failed retirement without displaying or
    // importing a previous account's items into the replacement session.
    let cached = isCartDeviceRevocationPending(merchantSlug)
      ? []
      : getCartFromStorage(merchantSlug);
    dispatch({
      cached,
      generation,
      merchantId,
      products: seedProducts(cached),
      type: 'link/start',
    });
    setHydrated(true);
    const provision = (attempt: number, run: number) =>
      createInitialCartProvisioner(context, {
        isLive: () => !cancelled && run === adoptRun,
        whenVisible: visibility.wait,
        schedule: (callback, delay) => {
          adoptTimer = setTimeout(callback, delay);
        },
      })(attempt);

    function retryAdopt(attempt: number, run: number) {
      if (attempt >= MAX_AUTO_RETRIES) {
        dispatch({
          generation,
          type: 'import/failed',
          code: 'temporarily_unavailable',
        });
        setLinkPhase('ready');
        return;
      }
      adoptTimer = setTimeout(
        () => void adopt(attempt + 1, run),
        backoffMs(ADOPT_RETRY_BASE_MS, attempt)
      );
    }

    async function adopt(attempt: number, run: number): Promise<void> {
      if (cancelled || generationRef.current !== generation || run !== adoptRun)
        return;
      if (document.hidden) {
        visibility.wait(() => void adopt(attempt, run));
        return;
      }
      if (
        (await ensureCartDeviceRevocationCleared?.(
          optionsRef.current.merchantSlug
        )) === false
      ) {
        if (
          cancelled ||
          generationRef.current !== generation ||
          run !== adoptRun
        )
          return;
        retryAdopt(attempt, run);
        return;
      }
      const result = await fetchSharedCartSnapshot(
        undefined,
        optionsRef.current.merchantSlug
      );
      if (cancelled || generationRef.current !== generation || run !== adoptRun)
        return;
      if (result.ok && isTerminalCart(result.snapshot) && cached.length) {
        // Re-read storage: another tab may have written fresher device
        // lines while revocation clearing and the fetch were awaited,
        // and persisting the effect-start copy would clobber them.
        cached = unimportedTerminalLines(
          getCartFromStorage(merchantSlug),
          result.snapshot.cartId,
          getSharedCartImportReceipt(merchantSlug)
        );
        if (cached.length) {
          // Provisioning reads the parked source again: remove only consumed mirror lines.
          saveCartToStorage(cached, merchantSlug);
          adoptOutcomeRef.current = 'expired';
          await provision(attempt, run);
          return;
        }
      }
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
          importInitialDeviceCart(
            context,
            result.snapshot,
            cached,
            generation,
            () => !cancelled && run === adoptRun
          );
        return;
      }
      if (result.retryable) {
        retryAdopt(attempt, run);
        return;
      }
      adoptOutcomeRef.current =
        result.code === 'not_found' ? 'bootstrap' : 'none';
      if (cached.length === 0) {
        dispatch({ generation, status: 'skipped', type: 'import/resolved' });
      } else if (planLegacyImport(cached, null, null).kind === 'blocked') {
        // No authority exists yet: surface the capacity chooser now and
        // keep the sender paused until explicit retry/discard resolves it.
        dispatch({ generation, type: 'import/capacity_exceeded' });
        return;
      } else {
        await provision(attempt, run);
        return;
      }
      setLinkPhase('ready');
    }

    context.retryLinkRef.current = () => {
      if (adoptTimer) clearTimeout(adoptTimer);
      visibility.cancel();
      adoptRun += 1;
      linkRunRef.current += 1;
      dispatch({ generation, type: 'link/retry' });
      setLinkPhase('adopting');
      void adopt(0, adoptRun);
    };
    void adopt(0, adoptRun);
    return () => {
      context.retryLinkRef.current = null;
      cancelled = true;
      if (adoptTimer) clearTimeout(adoptTimer);
      visibility.cancel();
      linkRunRef.current += 1;
    };
  }, [enabled, merchantId, merchantSlug, sessionGeneration]);

  useCartLinkPolling(context);

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
