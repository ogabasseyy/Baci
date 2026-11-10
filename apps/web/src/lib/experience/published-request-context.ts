import {
  type ResolveCartMerchantDeps,
  resolveCartMerchant,
} from '@/lib/cart/merchant-resolution';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';
/** Existing host/slug/referer validation, without adding cart enrollment or scope. */
export function resolvePublishedExperienceRequest(
  request: Request,
  deps?: ResolveCartMerchantDeps
) {
  return resolveCartMerchant(
    request,
    deps ?? {
      rpcClient: createAnonClient(),
      resolveAlias: getCurrentSlugForAlias,
    }
  );
}
