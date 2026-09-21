import { Alert } from 'react-native';
import {
  pickChangedPriceById,
  repriceCartItems,
} from '@/services/cart-reprice';
import { type CartItem, useCartStore } from '@/stores/cart-store';

/**
 * Reprices the cart against live merchant prices before order creation.
 * Returns true when prices changed: the cart is updated in place, the
 * shopper is told to review the new total, and the submit must abort so
 * checkout restarts from the corrected snapshot. Extracted from
 * use-checkout-submit (300-line file limit).
 */
export async function repriceCartOrAbort(
  itemsSnapshot: CartItem[],
  merchantId: string
): Promise<boolean> {
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
