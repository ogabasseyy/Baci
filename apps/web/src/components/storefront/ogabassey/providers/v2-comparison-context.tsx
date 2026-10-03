'use client';

import type React from 'react';
import { createContext, use, useEffect, useRef, useState } from 'react';
import type { Product } from '../types';

interface V2ComparisonContextType {
  compareItems: Product[];
  addToCompare: (product: Product) => void;
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

function getComparisonStorageKey(storageNamespace?: string | null) {
  const normalizedNamespace = storageNamespace?.trim();
  return normalizedNamespace
    ? `${COMPARISON_STORAGE_KEY}:${encodeURIComponent(normalizedNamespace)}`
    : COMPARISON_STORAGE_KEY;
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
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      try {
        nextComparisonItems = JSON.parse(stored);
      } catch (error) {
        console.error('Failed to parse comparison items', error);
      }
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
      sessionStorage.setItem(storageKey, JSON.stringify(compareItems));
    }
  }, [compareItems, hasHydratedStorage, storageKey]);

  const addToCompare = (product: Product) => {
    const hydratedComparisonItems = hydrateComparisonItems();

    setCompareItems((prev) => {
      const source = hydratedComparisonItems ?? prev;
      // Avoid duplicates
      if (source.some((p) => String(p.id) === String(product.id))) {
        return source;
      }

      // Limit to 4 items for UI sanity (1 main + 3 comparisons)
      if (source.length >= 4) {
        // Remove first, add new
        return [...source.slice(1), product];
      }
      return [...source, product];
    });
  };

  const removeFromCompare = (productId: number | string) => {
    const hydratedComparisonItems = hydrateComparisonItems();

    setCompareItems((prev) =>
      (hydratedComparisonItems ?? prev).filter(
        (p) => String(p.id) !== String(productId)
      )
    );
  };

  // Pre-hydration read without state updates: isInCompare runs during card
  // renders, where hydrateComparisonItems()' setState calls would warn.
  // The scheduled hydration effect still syncs state afterwards.
  const readStoredComparisonItems = (): Product[] | null => {
    if (typeof window === 'undefined') return null;
    if (
      hasHydratedStorageRef.current &&
      hydratedStorageKeyRef.current === storageKey
    )
      return null;
    const stored = sessionStorage.getItem(storageKey);
    if (!stored) return [];
    try {
      const parsed: unknown = JSON.parse(stored);
      return Array.isArray(parsed) ? (parsed as Product[]) : [];
    } catch {
      return [];
    }
  };

  const isInCompare = (productId: number | string) => {
    const stored = readStoredComparisonItems();
    return (stored ?? compareItems).some(
      (p) => String(p.id) === String(productId)
    );
  };

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
