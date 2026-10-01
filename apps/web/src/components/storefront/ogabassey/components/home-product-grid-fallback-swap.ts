import { useState } from 'react';
import {
  FALLBACK_RENDERED_IMAGE_COUNT,
  PRODUCTS_PER_PAGE,
} from './home-product-grid-constants';

/**
 * Sole primary export: page + image-tier state for the static-fallback →
 * interactive-grid swap. Owns the display-count state (including the
 * load-more replay the gate captured before the grid module loaded) and
 * the per-index tier predicate, so HomeProductGrid stays under the
 * 300-line module cap.
 */
export function useFallbackSwapPage({
  initialDisplayCount,
  replayLoadMore,
  matchFallbackImageTier,
  fallbackImageCount = FALLBACK_RENDERED_IMAGE_COUNT,
}: {
  initialDisplayCount: number;
  replayLoadMore: boolean;
  matchFallbackImageTier: boolean;
  fallbackImageCount?: number;
}) {
  const [displayCount, setDisplayCount] = useState(
    () =>
      Math.max(1, initialDisplayCount) +
      (replayLoadMore ? PRODUCTS_PER_PAGE : 0)
  );
  const [prevInitialDisplayCount, setPrevInitialDisplayCount] = useState(
    initialDisplayCount
  );
  if (initialDisplayCount !== prevInitialDisplayCount) {
    setPrevInitialDisplayCount(initialDisplayCount);
    setDisplayCount(Math.max(1, initialDisplayCount));
  }

  // Plain function by contract: manual useCallback/useMemo is forbidden —
  // the React Compiler stabilizes this (AGENTS.md NEVER rules).
  // Only the fallback-rendered leading slice keeps the JPEG tier: those
  // images are already fetched, so the swap reuses the cached bytes.
  // Cards below the fallback image count rendered placeholders (nothing
  // fetched) and load-more cards never fallback-rendered — both keep AVIF.
  function isFallbackTierIndex(index: number) {
    return matchFallbackImageTier && index < fallbackImageCount;
  }

  return { displayCount, setDisplayCount, isFallbackTierIndex } as const;
}
