'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onStoreChange: () => void): () => void {
  const mediaQuery = window.matchMedia(QUERY);
  mediaQuery.addEventListener('change', onStoreChange);
  return () => mediaQuery.removeEventListener('change', onStoreChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

// The server cannot observe a user's media preferences. Keeping this snapshot
// stable through hydration prevents reduced-motion clients from producing a
// different first render before the browser snapshot is applied.
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Hook to detect if the user prefers reduced motion.
 * Uses a hydration-safe server snapshot, then reflects the browser preference
 * once the client store is subscribed.
 */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
