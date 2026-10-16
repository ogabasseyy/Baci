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
  const status = useNativeSharedCartStore((state) => state.status);
  const snapshot = useNativeSharedCartStore((state) => state.snapshot);
  const metadataReady = useNativeSharedCartStore(
    (state) => state.metadataReady
  );
  const mergeConflicts = useNativeSharedCartStore(
    (state) => state.mergeConflicts
  );
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
