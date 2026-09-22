import * as Crypto from 'expo-crypto';
import { mintedCheckoutGenerations } from '@/lib/minted-checkout-generations';

export function emptyCheckoutCart() {
  return {
    items: [],
    lineSequence: 0,
    cartWideNegotiationActive: false,
    checkoutGeneration: mintedCheckoutGenerations.register(Crypto.randomUUID()),
  };
}
