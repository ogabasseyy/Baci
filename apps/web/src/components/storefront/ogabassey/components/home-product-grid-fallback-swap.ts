import type React from 'react';
import { useState } from 'react';
import type {
  ProductGridInteractionBindingsValue,
  ProductGridParticle,
} from './ProductGridInteractionBindings';
import type { ProductGridItemProps } from './ProductGridItem';
import type { Product } from '../types';

/**
 * How many leading fallback cards render a real `<img>`. Single source of
 * truth shared by the static fallback default and the swap-tier predicate
 * below: the remaining cards render the same placeholder shell the
 * interactive card shows pre-activation, so below-fold product images
 * never compete with LCP for bandwidth.
 */
export const FALLBACK_RENDERED_IMAGE_COUNT = 2;

export const PRODUCTS_PER_PAGE = 20;

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

export interface ProductGridInteractionBindingsModule {
  ProductGridInteractionBindings: React.ComponentType<{
    children: (
      bindings: ProductGridInteractionBindingsValue
    ) => React.ReactNode;
  }>;
}

export interface ProductGridItemModule {
  ProductGridItem: React.ComponentType<ProductGridItemProps>;
}

export interface PreviewCatalogModule {
  products: Product[];
}

// Module-scope so the dynamic import() expressions stay outside component
// bodies (React Compiler cannot lower import expressions). The deferred
// interactive layer loads on first grid activation only.
export const loadDefaultInteractionBindingsModule = () =>
  import('./ProductGridInteractionBindings');

export const loadDefaultInteractiveCardModule = () =>
  import('./ProductGridItem');

const NO_PARTICLES: ProductGridParticle[] = [];

/** Pre-activation bindings: inert until the interactive modules resolve. */
export const STATIC_BINDINGS: ProductGridInteractionBindingsValue = {
  isAdded: () => false,
  getCartQuantity: () => 0,
  isWishlisted: () => false,
  onAddToCart: (event) => {
    event.preventDefault();
    event.stopPropagation();
  },
  onToggleWishlist: (event) => {
    event.preventDefault();
    event.stopPropagation();
  },
  particles: NO_PARTICLES,
};
