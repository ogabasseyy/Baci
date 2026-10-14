'use client';

import type { CartSnapshot } from '@baci/shared/cart';
import { useReducer, useRef, useState } from 'react';
import type { createSharedCart } from './shared-cart-client';
import type {
  AdoptOutcome,
  UseSharedCartOptions,
} from './shared-cart-hook-support';
import {
  initialSharedCartState,
  sharedCartReducer,
} from './shared-cart-reducer';

export function useSharedCartRuntime(options: UseSharedCartOptions) {
  const {
    merchantId,
    merchantSlug,
    sessionGeneration,
    enabled = true,
    realtimeConnected = false,
    realtimeEnabled = false,
    surfaceActive = true,
  } = options;

  const [state, dispatch] = useReducer(
    sharedCartReducer,
    initialSharedCartState
  );

  const [hydrated, setHydrated] = useState(false);

  const [linkPhase, setLinkPhase] = useState<'adopting' | 'ready'>('adopting');

  const stateRef = useRef(state);

  stateRef.current = state;

  const generationRef = useRef(sessionGeneration);

  generationRef.current = sessionGeneration;

  const adoptOutcomeRef = useRef<AdoptOutcome>('unknown');

  const importOpIdsRef = useRef<Set<string>>(new Set());

  const createOpRef = useRef<string | null>(null);
  const createRequestRef = useRef<
    Parameters<typeof createSharedCart>[0] | null
  >(null);

  const createAttemptedRef = useRef(false);

  const bootstrappingRef = useRef(false);

  const lastFetchRef = useRef(0);

  const hydratingRef = useRef(false);

  const pendingHydrationRef = useRef<Set<string>>(new Set());

  const latestSnapshotRef = useRef<CartSnapshot | null>(null);

  // Invalidates in-flight hydration when the link restarts (merchant,
  // slug, or generation change) or unmounts.
  const linkRunRef = useRef(0);

  const tempCounterRef = useRef(0);

  const optionsRef = useRef({ merchantId, merchantSlug });

  optionsRef.current = { merchantId, merchantSlug };
  return {
    merchantId,
    merchantSlug,
    sessionGeneration,
    enabled,
    realtimeConnected,
    realtimeEnabled,
    surfaceActive,
    state,
    dispatch,
    hydrated,
    setHydrated,
    linkPhase,
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
    tempCounterRef,
    optionsRef,
  };
}
export type SharedCartRuntime = ReturnType<typeof useSharedCartRuntime>;
