import { useRef } from 'react';
import { Alert } from 'react-native';
import type { CartItem } from '@/stores/cart-store';
import { markSharedCartIntent } from '@/stores/shared-cart-writer';

/**
 * Cart-screen line handlers with in-flight guards: rapid taps on one
 * line collapse into a single store write instead of racing.
 */
export function useCartScreenItemHandlers({
  updateQuantity,
  removeItem,
  triggerHaptic,
}: {
  updateQuantity: (itemId: string, quantity: number) => void;
  removeItem: (itemId: string) => void;
  triggerHaptic: () => void;
}) {
  const pendingOperations = useRef<Set<string>>(new Set());

  const handleRemoveItem = (item: CartItem) => {
    if (pendingOperations.current.has(item.id)) return;
    markSharedCartIntent();
    Alert.alert('Remove Item', `Remove ${item.name} from cart?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          pendingOperations.current.add(item.id);
          removeItem(item.id);
          pendingOperations.current.delete(item.id);
        },
      },
    ]);
  };

  const handleQuantityChange = (item: CartItem, delta: number) => {
    if (pendingOperations.current.has(item.id)) return;
    const newQuantity = item.quantity + delta;
    triggerHaptic();

    if (newQuantity <= 0) {
      handleRemoveItem(item);
      return;
    }

    pendingOperations.current.add(item.id);
    updateQuantity(item.id, newQuantity);
    setTimeout(() => pendingOperations.current.delete(item.id), 200);
  };

  return { handleQuantityChange, handleRemoveItem };
}
