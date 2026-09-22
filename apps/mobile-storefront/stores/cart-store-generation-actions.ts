import * as Crypto from 'expo-crypto';
import type { StoreApi } from 'zustand';
import { createLogger } from '@/lib/logger';
import { mintedCheckoutGenerations } from '@/lib/minted-checkout-generations';
import { persistCheckoutGeneration } from '@/lib/persist-checkout-generation';
import type { CartState } from './cart-store-state';

const log = createLogger('CartStore');

export function createCheckoutGenerationActions(
  set: StoreApi<CartState>['setState']
): Pick<CartState, 'advanceCheckoutGeneration' | 'restoreItems'> {
  return {
    advanceCheckoutGeneration: async () => {
      const checkoutGeneration = mintedCheckoutGenerations.register(
        Crypto.randomUUID()
      );
      await persistCheckoutGeneration(checkoutGeneration);
      set({ checkoutGeneration });
    },
    restoreItems: async (
      items,
      cartWideNegotiationActive,
      checkoutGeneration
    ) => {
      set({
        items,
        ...(cartWideNegotiationActive !== undefined && {
          cartWideNegotiationActive,
        }),
        ...(checkoutGeneration !== undefined && { checkoutGeneration }),
      });
      if (checkoutGeneration !== undefined) {
        try {
          await persistCheckoutGeneration(checkoutGeneration);
        } catch (error) {
          log.error('Failed to persist restored checkout generation:', error);
        }
      }
    },
  };
}
