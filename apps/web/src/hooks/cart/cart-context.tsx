'use client';

import {
  createContext,
  use,
  useDeferredValue,
  useSyncExternalStore,
} from 'react';
import type { CommittedSnapshotStore } from '@/lib/committed-snapshot-store';
import type { CartContextType } from './cart-types';

type CartContextValue =
  | CartContextType
  | CommittedSnapshotStore<CartContextType>;

export const CartContext = createContext<CartContextValue | undefined>(
  undefined
);

const subscribeToNothing = () => () => {
  // Direct legacy context values have no separate subscription to detach.
};
const getNoSnapshot = () => null;

export const useCart = (): CartContextType => {
  const context = useCartSafe();
  if (context === null) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};

export const useCartSafe = (): CartContextType | null => {
  const context = use(CartContext);
  const store = context && 'kind' in context ? context : null;
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? subscribeToNothing,
    store?.getSnapshot ?? getNoSnapshot,
    store?.getServerSnapshot ?? getNoSnapshot
  );
  // Retain an already-revealed cart view if its ready-state UI suspends. Cart
  // lines and command authority are never deferred by this presentation flag.
  const ready = useDeferredValue(snapshot?.isHydrated ?? false);
  if (snapshot)
    return { ...snapshot, isHydrated: snapshot.isHydrated && ready };
  return context && !('kind' in context) ? context : null;
};
