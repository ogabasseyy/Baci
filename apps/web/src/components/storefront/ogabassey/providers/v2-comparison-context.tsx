'use client';

import type React from 'react';
import { createContext, use, useEffect, useRef, useState } from 'react';
import { comparisonSnapshotSchema } from '@/schemas/comparison-snapshot';
import type { Product } from '../types';

interface V2ComparisonContextType {
  compareItems: Product[];
  // Returns the evicted item when the tray was full, so callers announce
  // the replacement from the hydrated source instead of possibly-stale
  // state; null when the product was appended or already present.
  addToCompare: (product: Product) => Product | null;
  removeFromCompare: (productId: number | string) => void;
  isInCompare: (productId: number | string) => boolean;
  clearCompare: () => void;
}

const V2ComparisonContext = createContext<V2ComparisonContextType | undefined>(
  undefined
);
// Tab-session storage preserves navigation/reloads without carrying selections into a new session.
// Legacy localStorage selections are intentionally ignored.
const COMPARISON_STORAGE_KEY = 'ogabassey_v2_compare';
const STORAGE_HYDRATION_TIMEOUT_MS = 1200;
// Tray capacity (1 main + 3 comparisons): the live add path evicts the
// oldest entry past this, so hydration enforces the same invariant.
const COMPARISON_TRAY_CAPACITY = 4;

function getComparisonStorageKey(storageNamespace?: string | null) {
  const normalizedNamespace = storageNamespace?.trim();
  return normalizedNamespace
    ? `${COMPARISON_STORAGE_KEY}:${encodeURIComponent(normalizedNamespace)}`
    : COMPARISON_STORAGE_KEY;
}

function readValidStoredComparisonItems(stored: string): Product[] {
  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed)) return [];
  // Storage can hold more than the tray allows (buggy older client or
  // manual edits): dedupe by product id keeping the first row, then keep
  // the most recent entries, mirroring the live oldest-first eviction.
  const seenProductIds = new Set<string>();
  const deduped = parsed.flatMap((entry) => {
    const result = comparisonSnapshotSchema.safeParse(entry);
    if (!result.success) return [];
    const productKey = String(result.data.id);
    if (seenProductIds.has(productKey)) return [];
    seenProductIds.add(productKey);
    return [result.data];
  });
  return deduped.slice(-COMPARISON_TRAY_CAPACITY);
}

export const useV2Comparison = () => {
  const context = use(V2ComparisonContext);
  if (!context) {
    throw new Error(
      'useV2Comparison must be used within a V2ComparisonProvider'
    );
  }
  return context;
};

export const V2ComparisonProvider: React.FC<{
  children: React.ReactNode;
  storageNamespace?: string | null;
}> = ({ children, storageNamespace }) => {
  const storageKey = getComparisonStorageKey(storageNamespace);
  const [compareItems, setCompareItems] = useState<Product[]>([]);
  const [hasHydratedStorage, setHasHydratedStorage] = useState(false);
  const hasHydratedStorageRef = useRef(false);
  const hydratedStorageKeyRef = useRef<string | null>(null);

  const hydrateComparisonItems = () => {
    if (typeof window === 'undefined') {
      return null;
    }

    if (
      hasHydratedStorageRef.current &&
      hydratedStorageKeyRef.current === storageKey
    ) {
      return null;
    }

    let nextComparisonItems: Product[] = [];
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) nextComparisonItems = readValidStoredComparisonItems(stored);
    } catch {
      // Storage is optional: denied access starts an in-memory comparison.
    }

    hasHydratedStorageRef.current = true;
    hydratedStorageKeyRef.current = storageKey;
    setHasHydratedStorage(true);
    setCompareItems(nextComparisonItems);
    return nextComparisonItems;
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    if (
      hasHydratedStorageRef.current &&
      hydratedStorageKeyRef.current === storageKey
    ) {
      return undefined;
    }

    const activate = () => {
      detach();
      hydrateComparisonItems();
    };

    const detach = () => {
      window.removeEventListener('pointerdown', activate);
      window.removeEventListener('keydown', activate);
      window.removeEventListener('scroll', activate);
    };

    window.addEventListener('pointerdown', activate, {
      once: true,
      passive: true,
    });
    window.addEventListener('keydown', activate, { once: true });
    window.addEventListener('scroll', activate, {
      once: true,
      passive: true,
    });

    const idleCallbackId =
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(activate, {
            timeout: STORAGE_HYDRATION_TIMEOUT_MS,
          })
        : undefined;
    const timeoutId = window.setTimeout(activate, STORAGE_HYDRATION_TIMEOUT_MS);

    return () => {
      detach();
      window.clearTimeout(timeoutId);
      if (idleCallbackId !== undefined) {
        window.cancelIdleCallback?.(idleCallbackId);
      }
    };
  }, [storageKey]);

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      hasHydratedStorage &&
      hydratedStorageKeyRef.current === storageKey
    ) {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(compareItems));
      } catch {
        // The state remains usable when tab-session persistence is denied.
      }
    }
  }, [compareItems, hasHydratedStorage, storageKey]);

  const addToCompare = (product: Product): Product | null => {
    const hydratedComparisonItems = hydrateComparisonItems();
    // The hydrated list is authoritative when hydration just ran; otherwise
    // state is current (React flushes between discrete events, and this is
    // the only writer besides remove/clear). The updater below stays the
    // single tray writer so same-tick mutations still chain correctly.
    const source = hydratedComparisonItems ?? compareItems;
    // Identity is product-keyed by design: one row per product, so a
    // second option of the same product counts as already present.
    const isDuplicate = source.some(
      (p) => String(p.id) === String(product.id)
    );
    const replacedComparisonItem =
      !isDuplicate && source.length >= COMPARISON_TRAY_CAPACITY
        ? source[0]
        : null;

    setCompareItems((prev) => {
      const current = hydratedComparisonItems ?? prev;
      // Avoid duplicates
      if (current.some((p) => String(p.id) === String(product.id))) {
        return current;
      }

      // Limit to the tray capacity for UI sanity (1 main + 3 comparisons)
      if (current.length >= COMPARISON_TRAY_CAPACITY) {
        // Remove first, add new
        return [...current.slice(1), product];
      }
      return [...current, product];
    });
    return replacedComparisonItem;
  };

  const removeFromCompare = (productId: number | string) => {
    const hydratedComparisonItems = hydrateComparisonItems();

    setCompareItems((prev) =>
      (hydratedComparisonItems ?? prev).filter(
        (p) => String(p.id) !== String(productId)
      )
    );
  };

  // Match the empty server snapshot until scheduled hydration commits.
  const isInCompare = (productId: number | string) =>
    compareItems.some((p) => String(p.id) === String(productId));

  const clearCompare = () => {
    hydrateComparisonItems();
    setCompareItems([]);
  };

  return (
    <V2ComparisonContext.Provider
      value={{
        compareItems,
        addToCompare,
        removeFromCompare,
        isInCompare,
        clearCompare,
      }}
    >
      {children}
    </V2ComparisonContext.Provider>
  );
};
