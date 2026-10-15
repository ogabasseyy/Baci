import { Alert } from 'react-native';
import {
  pickChangedConditionById,
  pickChangedOfferIdById,
  pickChangedPriceById,
  repriceCartItems,
} from '@/services/cart-reprice';
import { useCartStore } from '@/stores/cart-store';
import type { CartItem } from '@/stores/cart-store.types';

/**
 * Reprices the checkout snapshot and aborts when prices moved: the cart is
 * updated to the live prices and the shopper retries against the new
 * total. Also aborts when lines vanished from the catalog — the orders
 * route would reject them, so stopping here gives an actionable removal
 * path instead of looping the same rejection. Returns true when the
 * submit must stop.
 */
export async function abortIfCartPricesStale(
  itemsSnapshot: CartItem[],
  merchantId: string
): Promise<boolean> {
  if (itemsSnapshot.length === 0) {
    return false;
  }
  const reprice = await repriceCartItems(itemsSnapshot, merchantId);
  if (reprice.unavailable.length > 0) {
    const names = reprice.unavailable.map((line) => line.name).join(', ');
    Alert.alert(
      'Items no longer available',
      `These items are no longer available: ${names}. Please remove them from your cart and try again.`,
      [{ text: 'OK' }]
    );
    return true;
  }
  const priceMoved = reprice.changes.length > 0;
  const conditionMoved = reprice.conditionChanges.length > 0;
  const offerAdopted = reprice.adoptions.length > 0;
  if (!priceMoved && !conditionMoved && !offerAdopted) {
    return false;
  }
  useCartStore
    .getState()
    .repriceItems(
      pickChangedPriceById(reprice),
      pickChangedConditionById(reprice),
      pickChangedOfferIdById(reprice)
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
