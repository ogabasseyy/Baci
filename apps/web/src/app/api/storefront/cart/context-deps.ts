import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import {
  type CartRequestContextDeps,
  createAnonMerchantFeatureLookup,
} from '@/lib/cart/request-context';
import type { CartServerTimer } from '@/lib/cart/server-timing';
import { verifyCartSessionProof } from '@/lib/cart/session-proof';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';

/** Merchant and proof resolution wiring shared by the cart root route. */
export function contextDeps(
  requireScope: CartRequestContextDeps['requireScope'],
  wrongScopeError: CartRequestContextDeps['wrongScopeError'],
  timer?: CartServerTimer
): CartRequestContextDeps {
  const loadMerchantFeatures = createAnonMerchantFeatureLookup(
    createAnonClient()
  );
  return {
    merchant: {
      resolveAlias: getCurrentSlugForAlias,
      rpcClient: createAnonClient(),
      // `features` is reported inside `auth`, which covers the whole
      // merchant and proof resolution.
      loadMerchantFeatures: timer
        ? (merchantId) =>
            timer.measure('features', () => loadMerchantFeatures(merchantId))
        : loadMerchantFeatures,
    },
    requireScope,
    verify: (proof) =>
      verifyCartSessionProof(proof, {
        environment: getCartProofEnvironment(),
      }),
    wrongScopeError,
  };
}
