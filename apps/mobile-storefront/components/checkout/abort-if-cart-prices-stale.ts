import { Alert } from 'react-native';
import {
  pickChangedConditionById,
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
  const priceMoved = reprice.changes.length > 0;
  const conditionMoved = reprice.conditionChanges.length > 0;
  if (!priceMoved && !conditionMoved) {
    return false;
  }
  useCartStore
    .getState()
    .repriceItems(
      pickChangedPriceById(reprice),
      pickChangedConditionById(reprice)
    );
  // A condition-only refresh still aborts so the reconciled line is what
  // checkout submits — but the message must describe the actual change,
  // not a price move that never happened.
  Alert.alert(
    priceMoved ? 'Prices updated' : 'Items updated',
    priceMoved
      ? 'Some prices changed since you added these items. Your cart has been updated to the latest prices — please review the new total and tap checkout again.'
      : 'The merchant updated some item details since you added these items. Your cart has been updated — please review and tap checkout again.',
    [{ text: 'OK' }]
  );
  return true;
}
