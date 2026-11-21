import { BANK_CARD_OFFER_REFERENCE_PATTERN } from '@baci/shared/constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCartStore } from '@/stores/cart-store';

const CONSUMED_MARKER = 'consumed';

function cartIdentity() {
  const { checkoutGeneration, items, sharedCartRef } = useCartStore.getState();
  if (!checkoutGeneration || !items.length) return null;
  return JSON.stringify([
    checkoutGeneration,
    sharedCartRef?.merchantId,
    sharedCartRef?.cartId,
    items.map((item) => [
      item.id,
      item.product_id,
      item.variant_id,
      item.offer_id,
      item.quantity,
      item.price,
      item.negotiatedPrice,
      item.hasAssurance,
    ]),
  ]);
}

function storageKey(orderId: string, reference: string) {
  if (!BANK_CARD_OFFER_REFERENCE_PATTERN.test(reference)) return null;
  return `bank-offer-checkout-cart:${orderId}:${reference}`;
}

export const deferredBankOfferCart = {
  capture: cartIdentity,
  async remember(orderId: string, reference: string, identity: string) {
    const key = storageKey(orderId, reference);
    if (!key) return;
    if (!(await AsyncStorage.getItem(key)))
      await AsyncStorage.setItem(key, identity);
  },
  async clearIfUnchanged(
    orderId: string,
    reference: string,
    isActive: () => boolean
  ) {
    const key = storageKey(orderId, reference);
    if (!key) return;
    const expected = await AsyncStorage.getItem(key);
    if (!isActive() || !expected || expected === CONSUMED_MARKER) return;
    if (!useCartStore.persist.hasHydrated()) return;
    if (cartIdentity() === expected) await useCartStore.getState().clearCart();
    // Keep a small marker so a repeated callback cannot bind this paid
    // order to a new cart, even if the original cart was edited.
    await AsyncStorage.setItem(key, CONSUMED_MARKER);
  },
};
