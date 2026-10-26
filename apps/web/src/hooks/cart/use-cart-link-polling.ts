'use client';

import { useEffect } from 'react';
import { getCartFromStorage, getSharedCartImportReceipt } from './cart-storage';
import { fetchSharedCartSnapshot } from './shared-cart-client';
import {
  FALLBACK_POLL_MS,
  jittered,
  RECONCILE_POLL_MS,
} from './shared-cart-hook-support';
import type { createCartProvisioning } from './shared-cart-provisioning';
import { isTerminalCart } from './shared-cart-queue';
import type { createCartSnapshotActions } from './shared-cart-snapshots';
import { unimportedTerminalLines } from './terminal-cart-cache';
import type { SharedCartRuntime } from './use-shared-cart-runtime';

/** Poll for convergence while linked, and provision after a polled terminal commits. */
export function useCartLinkPolling(
  context: SharedCartRuntime &
    Pick<ReturnType<typeof createCartProvisioning>, 'ensureCart'> &
    Pick<ReturnType<typeof createCartSnapshotActions>, 'hydrateMissing'>
) {
  const {
    enabled,
    realtimeConnected,
    sessionGeneration,
    state,
    surfaceActive,
    dispatch,
    stateRef,
    generationRef,
    lastFetchRef,
    optionsRef,
    hydrateMissing,
  } = context;
  // biome-ignore lint/correctness/useExhaustiveDependencies: hydrateMissing/ensureCart close over refs and stable dispatch only; listing them would restart polling every render.
  useEffect(() => {
    if (!enabled || !state.cartId || surfaceActive === false) return;
    const generation = sessionGeneration;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const baseMs = realtimeConnected ? RECONCILE_POLL_MS : FALLBACK_POLL_MS;
    const schedule = () => {
      timer = setTimeout(() => void tick(), jittered(baseMs));
    };
    // ensureCart reads the committed state, so provisioning must wait
    // until stateRef publishes the terminal snapshot this poll dispatched.
    const provisionAfterCommit = async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (stopped || generationRef.current !== generation) return;
        const committed = stateRef.current.confirmed;
        if (committed && isTerminalCart(committed)) {
          // A transient create failure leaves the import pending
          // with no queue head to retry it: replay the retained
          // create request here instead of stranding recovery.
          for (
            let provisionAttempt = 0;
            provisionAttempt < 5;
            provisionAttempt += 1
          ) {
            if (stopped || generationRef.current !== generation) return;
            const result = await context.ensureCart();
            if (!result || result.ok || !result.retryable) return;
            await new Promise((resolve) =>
              setTimeout(resolve, jittered(baseMs))
            );
          }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
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
          // A polled terminal leaves preserved device lines only in
          // storage; provision the replacement cart once it commits.
          if (isTerminalCart(result.snapshot)) {
            const preserved = unimportedTerminalLines(
              getCartFromStorage(optionsRef.current.merchantSlug),
              result.snapshot.cartId,
              getSharedCartImportReceipt(optionsRef.current.merchantSlug)
            );
            if (preserved.length > 0) void provisionAfterCommit();
          }
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
  return {};
}
