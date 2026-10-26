'use client';

import type React from 'react';
import {
  createContext,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  createCommittedSnapshotStore,
  type CommittedSnapshotStore,
} from '@/lib/committed-snapshot-store';
import { runWhenPageActivated } from '@/lib/dom/run-when-page-activated';
import type { Product } from '../types';

interface ToastState {
  show: boolean;
  message: string;
  type: 'add' | 'remove';
}

interface V2SavedContextType {
  savedItems: Product[];
  toggleSaved: (product: Product) => void;
  isSaved: (productId: number | string) => boolean;
  toastState: ToastState;
  dismissToast: () => void;
}

const V2SavedContext = createContext<
  CommittedSnapshotStore<V2SavedContextType> | undefined
>(undefined);
const SAVED_STORAGE_KEY = 'ogabassey_v2_saved';
const STORAGE_HYDRATION_TIMEOUT_MS = 1200;
let hasWarnedMissingSavedProvider = false;

const SERVER_SAVED_CONTEXT_FALLBACK: V2SavedContextType = {
  savedItems: [],
  toggleSaved: () => undefined,
  isSaved: () => false,
  toastState: {
    show: false,
    message: '',
    type: 'add',
  },
  dismissToast: () => undefined,
};

function warnSavedStorageUnavailable(error: unknown) {
  console.warn('Saved items storage is unavailable', error);
}

function warnMissingSavedProvider() {
  if (hasWarnedMissingSavedProvider) {
    return;
  }

  hasWarnedMissingSavedProvider = true;
  console.warn('V2SavedProvider is missing; using inert saved-items fallback');
}

function hasRequiredStoredString(
  value: Record<string, unknown>,
  key: 'image' | 'name' | 'price'
) {
  const fieldValue = value[key];
  return typeof fieldValue === 'string' && fieldValue.trim().length > 0;
}

function isStoredSavedProduct(value: unknown): value is Product {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const product = value as Record<string, unknown>;
  const hasValidId =
    (typeof product.id === 'string' && product.id.trim().length > 0) ||
    typeof product.id === 'number';

  return (
    hasValidId &&
    hasRequiredStoredString(product, 'name') &&
    hasRequiredStoredString(product, 'price') &&
    hasRequiredStoredString(product, 'image') &&
    typeof product.description === 'string'
  );
}

function warnInvalidSavedStorageData() {
  console.warn('Saved items storage returned invalid data');
}

function readSavedItemsFromStorage(): Product[] {
  let stored: string | null = null;

  try {
    stored = window.localStorage.getItem(SAVED_STORAGE_KEY);
  } catch (error) {
    warnSavedStorageUnavailable(error);
    return [];
  }

  if (!stored) {
    return [];
  }

  try {
    const parsedSavedItems: unknown = JSON.parse(stored);

    if (Array.isArray(parsedSavedItems)) {
      const validSavedItems = parsedSavedItems.filter(isStoredSavedProduct);

      if (validSavedItems.length !== parsedSavedItems.length) {
        warnInvalidSavedStorageData();
      }

      return validSavedItems;
    }

    warnInvalidSavedStorageData();
    return [];
  } catch (error) {
    console.error('Failed to parse saved items', error);
    return [];
  }
}

function writeSavedItemsToStorage(savedItems: Product[]) {
  try {
    window.localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(savedItems));
  } catch (error) {
    warnSavedStorageUnavailable(error);
  }
}

export const useV2Saved = () => {
  const store = use(V2SavedContext);
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? subscribeToMissingSaved,
    store?.getSnapshot ?? getSavedFallback,
    store?.getServerSnapshot ?? getSavedFallback
  );
  if (!store) {
    if (typeof window !== 'undefined') {
      warnMissingSavedProvider();
    }
  }
  return snapshot;
};

const getSavedFallback = () => SERVER_SAVED_CONTEXT_FALLBACK;
const subscribeToMissingSaved = () => () => undefined;

export const V2SavedProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [savedItems, setSavedItems] = useState<Product[]>([]);
  const [hasHydratedStorage, setHasHydratedStorage] = useState(false);
  const [toastState, setToastState] = useState<ToastState>({
    show: false,
    message: '',
    type: 'add',
  });
  const hasHydratedStorageRef = useRef(false);

  const hydrateSavedItems = () => {
    if (typeof window === 'undefined' || hasHydratedStorageRef.current) {
      return null;
    }

    const nextSavedItems = readSavedItemsFromStorage();

    hasHydratedStorageRef.current = true;
    setHasHydratedStorage(true);
    setSavedItems(nextSavedItems);
    return nextSavedItems;
  };

  useEffect(() => {
    if (typeof window === 'undefined' || hasHydratedStorageRef.current) {
      return undefined;
    }

    let cancelActivationGate: (() => void) | undefined;
    const activate = () => {
      detach();
      // A speculatively prerendered PDP runs this provider in a hidden tab;
      // hydrating here reads and then writes back `ogabassey_v2_saved` in the
      // shared localStorage, so a discarded prerender holding a stale snapshot
      // could clobber the real saved-list. Defer the storage read/write until
      // the page is actually presented (synchronous outside prerender).
      cancelActivationGate?.();
      cancelActivationGate = runWhenPageActivated(() => {
        hydrateSavedItems();
      });
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
      cancelActivationGate?.();
      window.clearTimeout(timeoutId);
      if (idleCallbackId !== undefined) {
        window.cancelIdleCallback?.(idleCallbackId);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && hasHydratedStorage) {
      writeSavedItemsToStorage(savedItems);
    }
  }, [hasHydratedStorage, savedItems]);

  const toggleSaved = (product: Product) => {
    const hydratedSavedItems = hydrateSavedItems();

    setSavedItems((prev) => {
      // First interaction may synchronously hydrate storage and enqueue that
      // state update in the same React batch; prefer the freshly-read storage
      // snapshot, otherwise use the already-hydrated state.
      const source = hydratedSavedItems ?? prev;
      // Ensure we compare IDs correctly (handle string/number mismatch if any)
      const exists = source.some((p) => String(p.id) === String(product.id));
      if (exists) {
        setToastState({
          show: true,
          message: 'Removed from Saved',
          type: 'remove',
        });
        return source.filter((p) => String(p.id) !== String(product.id));
      }
      setToastState({
        show: true,
        message: 'Added to Saved Items',
        type: 'add',
      });
      return [...source, product];
    });
  };

  const isSaved = (productId: number | string) => {
    return savedItems.some((p) => String(p.id) === String(productId));
  };

  const dismissToast = () => {
    setToastState((prev) => ({ ...prev, show: false }));
  };

  const value = { savedItems, toggleSaved, isSaved, toastState, dismissToast };
  const [store] = useState(() => createCommittedSnapshotStore(value));
  useLayoutEffect(() => store.publish(value));

  return (
    <V2SavedContext.Provider value={store}>{children}</V2SavedContext.Provider>
  );
};
