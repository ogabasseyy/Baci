'use client';

import type { CartSnapshot } from '@baci/shared/cart';
import { useEffect, useReducer, useRef, useState } from 'react';
import { getCartCookieEpoch } from './cart-cross-tab-lock';
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

  const generationRef = useRef(sessionGeneration);
  const enabledRef = useRef(enabled);
  const cookieEpochRef = useRef<{ value: string | null | undefined } | null>(
    null
  );

  // Publish refs only after commit: an abandoned render must not let
  // hydration, polling, or send operations observe an uncommitted
  // generation/state and discard their completions as stale.
  useEffect(() => {
    if (
      !cookieEpochRef.current ||
      generationRef.current !== sessionGeneration ||
      optionsRef.current.merchantId !== merchantId ||
      (!enabledRef.current && enabled)
    ) {
      cookieEpochRef.current = { value: getCartCookieEpoch(merchantSlug) };
    }
    stateRef.current = state;
    generationRef.current = sessionGeneration;
    enabledRef.current = enabled;
    optionsRef.current = { merchantId, merchantSlug };
  });

  const adoptOutcomeRef = useRef<AdoptOutcome>('unknown');

  const importOpIdsRef = useRef<Set<string>>(new Set());

  const createOpRef = useRef<string | null>(null);
  const createRequestRef = useRef<
    Parameters<typeof createSharedCart>[0] | null
  >(null);

  // Device line IDs the in-flight create consumes, recorded on the
  // import receipt so terminal recovery can identify them exactly.
  const createSourceIdsRef = useRef<string[]>([]);

  const createAttemptedRef = useRef(false);
  const retiredCartIdRef = useRef<string | null>(null);

  const bootstrappingRef = useRef(false);

  const lastFetchRef = useRef(0);

  const hydratingRef = useRef(false);

  const pendingHydrationRef = useRef<Set<string>>(new Set());

  const latestSnapshotRef = useRef<CartSnapshot | null>(null);

  // Invalidates in-flight hydration when the link restarts (merchant,
  // slug, or generation change) or unmounts.
  const linkRunRef = useRef(0);
  const retryLinkRef = useRef<(() => void) | null>(null);

  const tempCounterRef = useRef(0);

  const optionsRef = useRef({ merchantId, merchantSlug });
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
    enabledRef,
    cookieEpochRef,
    adoptOutcomeRef,
    importOpIdsRef,
    createOpRef,
    createRequestRef,
    createSourceIdsRef,
    createAttemptedRef,
    retiredCartIdRef,
    bootstrappingRef,
    lastFetchRef,
    hydratingRef,
    pendingHydrationRef,
    latestSnapshotRef,
    linkRunRef,
    retryLinkRef,
    tempCounterRef,
    optionsRef,
  };
}
export type SharedCartRuntime = ReturnType<typeof useSharedCartRuntime>;
