import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';

/**
 * A pending choice owns the screen; background sync can coexist with
 * visible items. The gate mirrors SharedCartStatusPanel's own render
 * condition so the screen never resolves to the panel's null render:
 * with zero items the status panel owns the screen only while it has
 * something to show (not ready, no snapshot yet, metadata pending, or
 * unresolved merge conflicts).
 */
export function useCartStatusOnly(itemCount: number): boolean {
  const enabled = useNativeSharedCartStore((state) => state.enabled);
  // A settled ready state with no server cart and no local items is
  // the normal empty-cart view: the account panel must mount there so
  // it can bootstrap and offer a saved account cart.
  const status = useNativeSharedCartStore((state) => state.status);
  const snapshot = useNativeSharedCartStore((state) => state.snapshot);
  const metadataReady = useNativeSharedCartStore(
    (state) => state.metadataReady
  );
  const mergeConflicts = useNativeSharedCartStore(
    (state) => state.mergeConflicts
  );
  if (status === 'ready' && !snapshot && itemCount === 0) return false;
  // A sync error never owns the screen: the empty/loaded cart views
  // already embed the status panel above their normal content, so the
  // shopper keeps a way to keep shopping instead of a dead-end
  // full-screen error with only a retry action.
  if (status === 'error') return false;
  const panelHasContent = !(
    status === 'ready' &&
    snapshot &&
    metadataReady &&
    mergeConflicts.length === 0
  );
  return (
    enabled &&
    panelHasContent &&
    (status === 'choice_required' || itemCount === 0)
  );
}
