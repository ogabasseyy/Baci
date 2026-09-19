import type Fuse from 'fuse.js';
import { useEffect, useRef, useState } from 'react';
import type { Product } from '@/lib/products';

export interface PreviewSearchIndex {
  /** Null until the index builds (or when search is inactive): the grid
   * falls back to the unfiltered list, exactly as the old null-index path. */
  fuse: Fuse<Product> | null;
  /** True when the fuse.js chunk failed to load. The next query/products
   * change re-attempts automatically; `retrySearch` forces an attempt. */
  searchFailed: boolean;
  /** Re-attempt a failed chunk load without waiting for new input. */
  retrySearch: () => void;
}

/**
 * Lazily built client search index, preview merchants only: importing
 * fuse.js statically would ship the engine to every storefront page load
 * even though live storefronts search server-side and never touch it.
 * Rebuilt whenever the query or products change, mirroring the previous
 * per-render freshness.
 *
 * Failure is recoverable, never stuck: a rejected chunk (offline or stale
 * deployment) surfaces `searchFailed` instead of an unhandled rejection,
 * the grid keeps showing the unfiltered list, and any new query, product
 * list, or explicit retry re-imports the chunk.
 */
export function usePreviewSearch({
  debouncedSearchQuery,
  isPreviewMode,
  products,
}: {
  debouncedSearchQuery: string;
  isPreviewMode: boolean;
  products: Product[];
}): PreviewSearchIndex {
  const [fuse, setFuse] = useState<Fuse<Product> | null>(null);
  const [searchFailed, setSearchFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const prevProductsRef = useRef(products);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is a write-only re-trigger for retrySearch.
  useEffect(() => {
    if (!isPreviewMode || !debouncedSearchQuery) {
      setFuse(null);
      setSearchFailed(false);
      return;
    }
    let cancelled = false;
    // A catalog swap must not keep searching the previous index while the
    // rebuild is in flight: clear it so the grid falls back to the
    // unfiltered CURRENT list (the documented null-index path). A mere
    // query change on the same catalog keeps the warm index — no flash.
    if (prevProductsRef.current !== products) {
      prevProductsRef.current = products;
      setFuse(null);
    }
    setSearchFailed(false);
    void import('fuse.js')
      .then(({ default: FuseImpl }) => {
        if (cancelled) return;
        setFuse(
          new FuseImpl(products, {
            keys: ['name', 'description', 'brand'],
            includeScore: true,
            threshold: 0.4,
          })
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('Failed to load preview search:', error);
        setFuse(null);
        setSearchFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, debouncedSearchQuery, isPreviewMode, products]);

  // Plain function by contract: manual useCallback/useMemo is forbidden —
  // the React Compiler stabilizes this (AGENTS.md NEVER rules).
  function retrySearch() {
    setAttempt((count) => count + 1);
  }

  return { fuse, searchFailed, retrySearch };
}
