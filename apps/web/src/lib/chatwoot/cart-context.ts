import type { CartSnapshot } from '@baci/shared/cart';
import type { NextRequest } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import { createAnonMerchantFeatureLookup } from '@/lib/cart/merchant-resolution';
import type { CartPrincipal } from '@/lib/cart/principal';
import {
  requestUsesDeviceProof,
  resolveCartRequestContext,
} from '@/lib/cart/request-context';
import { createCartScopedClient } from '@/lib/cart/scoped-client';
import { getCart } from '@/lib/cart/service';
import { verifyCartSessionProof } from '@/lib/cart/session-proof';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';
import {
  ChatwootCommerceContextError,
  type ChatwootCommerceContextState,
  type ChatwootTenantBinding,
  getChatwootTenantBinding,
  hashCartSessionProof,
  normalizeHttpsOrigin,
} from './commerce-context';

export type ChatwootCartContextResult =
  | {
      ok: true;
      binding: ChatwootTenantBinding;
      state: ChatwootCommerceContextState;
      /** RLS-scoped shopper principal resolved from the request proof. */
      principal: CartPrincipal;
      /** Server-loaded cart; never serialized directly to Chatwoot. */
      cart: CartSnapshot;
      /** Merchant-scoped public catalog names for in-chat cart presentation. */
      productNames?: Record<string, string>;
    }
  | {
      ok: false;
      status: 400 | 401 | 403 | 404 | 409 | 503;
      code: string;
    };

function cartContextError(
  code: string
): Extract<ChatwootCartContextResult, { ok: false }> {
  if (code === 'disabled' || code === 'binding_unavailable') {
    return { ok: false, status: 404, code };
  }
  if (code === 'invalid_config' || code === 'temporarily_unavailable') {
    return { ok: false, status: 503, code: 'temporarily_unavailable' };
  }
  if (
    code === 'missing_proof' ||
    code === 'invalid_proof' ||
    code === 'expired_proof' ||
    code === 'unauthorized'
  ) {
    return { ok: false, status: 401, code };
  }
  if (code === 'merchant_mismatch') {
    return { ok: false, status: 403, code };
  }
  if (code === 'version_conflict' || code === 'cart_locked') {
    return { ok: false, status: 409, code };
  }
  if (code === 'merchant_unavailable') {
    return { ok: false, status: 404, code };
  }
  if (code === 'merchant_unresolved') {
    return { ok: false, status: 404, code };
  }
  return { ok: false, status: 503, code: 'temporarily_unavailable' };
}

export async function loadChatwootCartContext(
  request: NextRequest,
  options: { includeProductNames?: boolean } = {}
): Promise<ChatwootCartContextResult> {
  if (process.env.EKAETTE_CHATWOOT_CONTEXT_ENABLED !== 'true') {
    return { ok: false, status: 404, code: 'disabled' };
  }
  if (requestUsesDeviceProof(request)) {
    return { ok: false, status: 403, code: 'browser_session_required' };
  }

  let verifiedProof: string | null = null;
  let cartContext: Awaited<ReturnType<typeof resolveCartRequestContext>>;
  try {
    const client = createAnonClient();
    cartContext = await resolveCartRequestContext(request, {
      merchant: {
        resolveAlias: getCurrentSlugForAlias,
        rpcClient: client,
        loadMerchantFeatures: createAnonMerchantFeatureLookup(client),
      },
      requireScope: 'session',
      verify: (proof) => {
        // Hash the exact credential that produced the branded principal.
        // Re-reading the request here could select a different header or cookie.
        verifiedProof = proof;
        return verifyCartSessionProof(proof, {
          environment: getCartProofEnvironment(),
        });
      },
      wrongScopeError: 'unauthorized',
    });
  } catch {
    return cartContextError('temporarily_unavailable');
  }
  if (!cartContext.ok) return cartContextError(cartContext.error);
  if (!verifiedProof) return { ok: false, status: 401, code: 'missing_proof' };

  let binding: ChatwootTenantBinding;
  try {
    binding = getChatwootTenantBinding(cartContext.merchant.id);
  } catch (error) {
    if (error instanceof ChatwootCommerceContextError) {
      return cartContextError(error.code);
    }
    return cartContextError('temporarily_unavailable');
  }

  const requestOrigin = normalizeHttpsOrigin(request.headers.get('origin'));
  if (!requestOrigin || requestOrigin !== binding.origin) {
    return { ok: false, status: 403, code: 'origin_mismatch' };
  }

  let snapshot: Awaited<ReturnType<typeof getCart>>;
  try {
    snapshot = await getCart({
      client: createCartScopedClient(cartContext.principal),
      principal: cartContext.principal,
    });
  } catch {
    return cartContextError('temporarily_unavailable');
  }
  if (!snapshot.ok) return cartContextError(snapshot.code);
  if (
    snapshot.cart.merchantId !== cartContext.merchant.id ||
    snapshot.cart.cartId !== cartContext.principal.cartId ||
    !cartContext.principal.grantId
  ) {
    return { ok: false, status: 403, code: 'cart_binding_mismatch' };
  }

  let productNames: Record<string, string> | undefined;
  if (options.includeProductNames && snapshot.cart.lines.length > 0) {
    const productIds = [
      ...new Set(snapshot.cart.lines.map((line) => line.item.productId)),
    ];
    try {
      const { data, error } = await createAnonClient()
        .from('products')
        .select('id, name')
        .eq('merchant_id', cartContext.merchant.id)
        .in('id', productIds);
      if (error || !data) return cartContextError('temporarily_unavailable');
      productNames = Object.fromEntries(
        data
          .filter(
            (row): row is typeof row & { id: string; name: string } =>
              typeof row.id === 'string' &&
              typeof row.name === 'string' &&
              row.name.trim().length > 0
          )
          .map((row) => [row.id, row.name.trim().slice(0, 120)])
      );
      if (productIds.some((productId) => !productNames?.[productId])) {
        return cartContextError('temporarily_unavailable');
      }
    } catch {
      return cartContextError('temporarily_unavailable');
    }
  }

  return {
    ok: true,
    binding,
    cart: snapshot.cart,
    principal: cartContext.principal,
    ...(productNames ? { productNames } : {}),
    state: {
      cartId: snapshot.cart.cartId,
      cartSessionSha256: hashCartSessionProof(verifiedProof),
      cartVersion: snapshot.cart.version,
      grantId: cartContext.principal.grantId,
      inboxId: binding.inboxId,
      merchantId: cartContext.merchant.id,
      origin: binding.origin,
      principalId: cartContext.principal.principalId,
      websiteToken: binding.websiteToken,
    },
  };
}
