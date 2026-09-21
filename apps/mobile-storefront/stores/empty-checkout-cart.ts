import * as Crypto from 'expo-crypto';
import { registerMintedCheckoutGeneration } from '@/lib/minted-checkout-generations';

export function emptyCheckoutCart() {
  return {
    items: [],
    lineSequence: 0,
    cartWideNegotiationActive: false,
    checkoutGeneration: registerMintedCheckoutGeneration(Crypto.randomUUID()),
  };
}
