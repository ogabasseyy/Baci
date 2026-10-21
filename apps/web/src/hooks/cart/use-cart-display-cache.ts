'use client';
import { useEffect } from 'react';
import { saveCartToStorage } from './cart-storage';
import { isTerminalCart } from './shared-cart-queue';
import { stripUnconfirmedDisplayLines } from './shared-cart-storage';
import type { SharedCartRuntime } from './use-shared-cart-runtime';
/** Persist only confirmed display data after legacy import completes. */
export function useCartDisplayCache(context: SharedCartRuntime) {
  const { enabled, state, sessionGeneration, merchantSlug } = context;
  // The display cache mirrors confirmed state only once the legacy
  // import resolves: persisting earlier would overwrite the import
  // source before its receipt exists.
  useEffect(() => {
    // Skip the merchant-switch transition commit: the reducer state still
    // belongs to the previous session while the slug already names the
    // next one, so persisting here would file A's lines under B's key.
    // A terminal snapshot adopted via polling/send-queue must not erase
    // unimported device lines still held only in storage: the next
    // provisioning reads that storage cache (and filters consumed
    // mirrors), so leave it untouched here.
    if (
      !enabled ||
      state.generation !== sessionGeneration ||
      (state.importStatus !== 'done' && state.importStatus !== 'skipped') ||
      (state.confirmed !== null && isTerminalCart(state.confirmed))
    )
      return;
    saveCartToStorage(
      stripUnconfirmedDisplayLines(state.display),
      merchantSlug
    );
  }, [
    enabled,
    merchantSlug,
    sessionGeneration,
    state.confirmed,
    state.display,
    state.generation,
    state.importStatus,
  ]);
}
