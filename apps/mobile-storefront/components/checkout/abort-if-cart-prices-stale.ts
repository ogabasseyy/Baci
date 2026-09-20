import { Alert } from 'react-native';
import {
  pickChangedPriceById,
  repriceCartItems,
} from '@/services/cart-reprice';
import { useCartStore } from '@/stores/cart-store';
import type { CartItem } from '@/stores/cart-store.types';

/**
 * Reprices the checkout snapshot and aborts when prices moved: the cart is
 * updated to the live prices and the shopper retries against the new
 * total. Returns true when the submit must stop.
 */
export async function abortIfCartPricesStale(
  itemsSnapshot: CartItem[],
  merchantId: string
): Promise<boolean> {
  if (itemsSnapshot.length === 0) {
    return false;
  }
  const reprice = await repriceCartItems(itemsSnapshot, merchantId);
  if (reprice.changes.length === 0) {
    return false;
  }
  useCartStore.getState().repriceItems(pickChangedPriceById(reprice));
  Alert.alert(
    'Prices updated',
    'Some prices changed since you added these items. Your cart has been updated to the latest prices — please review the new total and tap checkout again.',
    [{ text: 'OK' }]
  );
  return true;
}
