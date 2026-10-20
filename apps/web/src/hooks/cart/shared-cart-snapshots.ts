'use client';

import { type CartSnapshot, cartLineIdentity } from '@baci/shared/cart';

import type { Product } from '@/lib/products';

import {
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
} from './shared-cart-client';
import { FETCH_COALESCE_MS } from './shared-cart-hook-support';
import type { SharedCartRuntime } from './use-shared-cart-runtime';

export function createCartSnapshotActions(context: SharedCartRuntime) {
  const {
    enabled,
    dispatch,
    stateRef,
    generationRef,
    adoptOutcomeRef,
    lastFetchRef,
    hydratingRef,
    pendingHydrationRef,
    latestSnapshotRef,
    linkRunRef,
    optionsRef,
  } = context;

  // Hydrates product shells for lines the cache never saw. Every
  // snapshot path calls this (adopt, poll, foreground refresh,
  // reconcile) so lines another device adds never stick on the
  // fallback shell. Concurrent calls merge into one loop; ids filter
  // against the latest snapshot seen rather than the one that started
  // the loop (a newer snapshot's ids must survive a slow fetch) or the
  // reducer's confirmed lines (null before adoption lands and stale in
  // the dispatch lag window). Product shells keyed for lines that left
  // the cart are inert: display derives from confirmed lines only.
  async function hydrateMissing(snapshot: CartSnapshot): Promise<void> {
    const generation = generationRef.current;
    const linkRun = linkRunRef.current;
    const live = (): boolean =>
      linkRunRef.current === linkRun && generationRef.current === generation;
    latestSnapshotRef.current = snapshot;
    for (const line of snapshot.lines) {
      pendingHydrationRef.current.add(line.item.productId);
    }
    if (hydratingRef.current) return;
    hydratingRef.current = true;
    try {
      while (pendingHydrationRef.current.size > 0) {
        if (!live()) return;
        const universe = latestSnapshotRef.current?.lines ?? [];
        const known = stateRef.current.products;
        const ids = [...pendingHydrationRef.current].filter((id) =>
          universe.some(
            (line) =>
              line.item.productId === id &&
              known[cartLineIdentity(line.item)] === undefined
          )
        );
        pendingHydrationRef.current.clear();
        if (ids.length === 0) return;
        const products = await fetchSharedCartProducts(
          ids,
          optionsRef.current.merchantId
        );
        if (!live()) return;
        const keyed: Record<string, Product> = {};
        for (const line of latestSnapshotRef.current?.lines ?? []) {
          const product = products.get(line.item.productId);
          if (product) keyed[cartLineIdentity(line.item)] = product;
        }
        if (Object.keys(keyed).length > 0) {
          dispatch({
            generation,
            products: keyed,
            type: 'products/hydrated',
          });
        }
      }
    } finally {
      hydratingRef.current = false;
    }
  }

  async function refreshNow(force = false): Promise<void> {
    const generation = generationRef.current;
    if (!enabled || (!force && document.hidden)) return;
    // Adoption owns the first fetch: a foreground refresh racing a
    // deferred adopt would double-fetch and dispatch a bare poll
    // snapshot before the link (import, hydration, send-ready) runs.
    if (adoptOutcomeRef.current === 'unknown') return;
    if (!force && Date.now() - lastFetchRef.current < FETCH_COALESCE_MS) return;
    const result = await fetchSharedCartSnapshot(
      undefined,
      optionsRef.current.merchantSlug
    );
    if (generationRef.current !== generation) return;
    if (!result.ok) return;
    lastFetchRef.current = Date.now();
    dispatch({
      generation,
      snapshot: result.snapshot,
      type: 'snapshot/polled',
    });
    void hydrateMissing(result.snapshot);
  }
  return { hydrateMissing, refreshNow };
}
