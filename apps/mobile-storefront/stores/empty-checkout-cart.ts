import * as Crypto from 'expo-crypto';

export function emptyCheckoutCart() {
  return {
    items: [],
    lineSequence: 0,
    cartWideNegotiationActive: false,
    checkoutGeneration: Crypto.randomUUID(),
  };
}
