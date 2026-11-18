import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';
import { getCartProofEnvironment } from './cart-runtime-env';
import {
  type CartRequestContextDeps,
  cachedCartMerchantLookups,
} from './request-context';
import type { CartServerTimer } from './server-timing';
import { verifyCartSessionProof } from './session-proof';

export function createCartRouteContextDeps(
  requireScope: CartRequestContextDeps['requireScope'],
  wrongScopeError: CartRequestContextDeps['wrongScopeError'],
  timer?: CartServerTimer
): CartRequestContextDeps {
  const cached = cachedCartMerchantLookups(createAnonClient());
  return {
    merchant: {
      resolveAlias: getCurrentSlugForAlias,
      rpcClient: cached.rpcClient,
      loadMerchantFeatures: timer
        ? (id) => timer.measure('auth-features', () => cached.features(id))
        : cached.features,
    },
    requireScope,
    verify: (proof) =>
      verifyCartSessionProof(proof, { environment: getCartProofEnvironment() }),
    wrongScopeError,
  };
}
