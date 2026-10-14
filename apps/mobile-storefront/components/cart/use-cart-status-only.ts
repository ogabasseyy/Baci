import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';

/** A pending choice owns the screen; background sync can coexist with visible items. */
export function useCartStatusOnly(itemCount: number): boolean {
  const enabled = useNativeSharedCartStore((state) => state.enabled);
  const status = useNativeSharedCartStore((state) => state.status);
  return (
    enabled &&
    (status === 'choice_required' || (itemCount === 0 && status !== 'ready'))
  );
}
