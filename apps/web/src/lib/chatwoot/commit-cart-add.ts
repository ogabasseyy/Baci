import { NextResponse } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import { resolveChatwootCartProofExpiry } from '@/lib/cart/chatwoot-proof-expiry';
import {
  loadLiveGrantOperations,
  upgradeLegacySessionPrincipal,
} from '@/lib/cart/grant-operations';
import { setCartSessionCookie } from '@/lib/cart/response';
import { createCartScopedClient } from '@/lib/cart/scoped-client';
import { getCart } from '@/lib/cart/service';
import {
  cartSessionCookieMaxAge,
  issueCartSessionProof,
} from '@/lib/cart/session-proof';
import type { ChatwootCartContextResult } from '@/lib/chatwoot/cart-context';
import {
  hashCartSessionProof,
  renewChatwootSessionCapability,
} from '@/lib/chatwoot/commerce-context';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

function unavailable(status: number, code: string) {
  return NextResponse.json(
    { accepted: false, code },
    { status, headers: NO_STORE_HEADERS }
  );
}

/** Commits an add through the canonical versioned, idempotent cart RPC. */
export async function commitChatwootCartAdd(input: {
  cartContext: Extract<ChatwootCartContextResult, { ok: true }>;
  cartVersion: number;
  operationId: string;
  productSlug: string;
  sessionToken: string;
  variantId?: string;
}) {
  const { cartContext } = input;
  let client: ReturnType<typeof createCartScopedClient>;
  try {
    client = createCartScopedClient(cartContext.principal);
  } catch {
    return unavailable(503, 'temporarily_unavailable');
  }
  let principal: typeof cartContext.principal | null;
  try {
    principal = await upgradeLegacySessionPrincipal(
      client,
      cartContext.principal
    );
  } catch {
    return unavailable(503, 'temporarily_unavailable');
  }
  if (!principal) return unavailable(403, 'forbidden');

  let liveGrant: Awaited<ReturnType<typeof loadLiveGrantOperations>>;
  try {
    liveGrant = await loadLiveGrantOperations(client, principal);
  } catch {
    return unavailable(503, 'temporarily_unavailable');
  }
  if (
    !liveGrant?.allowedOperations.includes('add') ||
    !principal.allowedOperations.includes('add')
  ) {
    return unavailable(403, 'forbidden');
  }

  if (input.cartVersion > cartContext.cart.version) {
    let latestCart: Awaited<ReturnType<typeof getCart>>;
    try {
      latestCart = await getCart({ client, principal });
    } catch {
      return unavailable(503, 'temporarily_unavailable');
    }
    if (
      !latestCart.ok ||
      latestCart.cart.cartId !== principal.cartId ||
      latestCart.cart.merchantId !== cartContext.state.merchantId ||
      latestCart.cart.version < input.cartVersion
    ) {
      return unavailable(409, 'refresh_required');
    }
  }

  let mutation: unknown;
  try {
    const response = await client.rpc('commerce_cart_add_chatwoot', {
      p_cart_id: principal.cartId,
      p_expected_version: input.cartVersion,
      p_operation_id: input.operationId,
      p_product_slug: input.productSlug,
      p_variant_id: input.variantId ?? null,
    });
    if (response.error) return unavailable(503, 'temporarily_unavailable');
    mutation = response.data;
  } catch {
    return unavailable(503, 'temporarily_unavailable');
  }
  if (
    !mutation ||
    typeof mutation !== 'object' ||
    !('ok' in mutation) ||
    typeof mutation.ok !== 'boolean'
  ) {
    return unavailable(503, 'temporarily_unavailable');
  }
  if (!mutation.ok) {
    const code =
      'code' in mutation && typeof mutation.code === 'string'
        ? mutation.code
        : 'temporarily_unavailable';
    if (code === 'expired' || code === 'not_found') {
      return unavailable(410, 'cart_expired');
    }
    const status =
      code === 'version_conflict' ||
      code === 'idempotency_conflict' ||
      code === 'cart_locked'
        ? 409
        : code === 'unauthorized'
          ? 403
          : code === 'invalid_item'
            ? 409
            : 503;
    return unavailable(
      status,
      status === 403
        ? 'forbidden'
        : status === 409
          ? code === 'invalid_item'
            ? 'not_addable'
            : code === 'idempotency_conflict'
              ? 'idempotency_conflict'
              : 'refresh_required'
          : 'temporarily_unavailable'
    );
  }

  // The RPC returns the canonical stored receipt. Reload the owner-scoped cart
  // snapshot for proof renewal; availability is still revalidated at checkout.
  let currentCart: Awaited<ReturnType<typeof getCart>>;
  try {
    currentCart = await getCart({ client, principal });
  } catch {
    return unavailable(503, 'temporarily_unavailable');
  }
  if (
    !currentCart.ok ||
    currentCart.cart.cartId !== principal.cartId ||
    currentCart.cart.merchantId !== cartContext.state.merchantId
  ) {
    return unavailable(503, 'temporarily_unavailable');
  }
  const result = {
    cart: currentCart.cart,
    operationId: input.operationId,
    replayed: 'replayed' in mutation && mutation.replayed === true,
  };

  let renewalGrant: Awaited<ReturnType<typeof loadLiveGrantOperations>> = null;
  try {
    renewalGrant = await loadLiveGrantOperations(client, principal);
  } catch {
    console.error('Chatwoot live grant refresh failed after cart add');
  }
  let liveCartVersion =
    !result.replayed && result.cart.version >= cartContext.state.cartVersion
      ? result.cart.version
      : null;
  let proofCartExpiresAt = result.cart.expiresAt;
  if (result.replayed) {
    try {
      const latestCart = await getCart({ client, principal });
      if (
        latestCart.ok &&
        latestCart.cart.cartId === principal.cartId &&
        latestCart.cart.merchantId === cartContext.state.merchantId &&
        latestCart.cart.version >= cartContext.state.cartVersion
      ) {
        liveCartVersion = latestCart.cart.version;
        proofCartExpiresAt = latestCart.cart.expiresAt;
      }
    } catch {
      // An accepted replay remains accepted; omit renewed credentials.
    }
  }

  const renewableOperations = renewalGrant?.allowedOperations.filter(
    (operation) => principal.allowedOperations.includes(operation)
  );
  let proof: string | null = null;
  let sessionToken: string | null = null;
  let maxAge = 0;
  if (liveCartVersion !== null && renewalGrant && renewableOperations?.length) {
    const expiry = resolveChatwootCartProofExpiry({
      cartExpiresAt: proofCartExpiresAt,
      existingProofExpiresAt: principal.expiresAt,
      liveGrantExpiresAt: renewalGrant.grantExpiresAt,
    });
    if (expiry !== null) {
      try {
        proof = issueCartSessionProof(
          {
            allowedOperations: renewableOperations,
            cartId: principal.cartId,
            grantId: principal.grantId,
            grantExpiresAt: expiry,
            merchantId: cartContext.state.merchantId,
            principalId: principal.principalId,
            scope: 'session',
          },
          { environment: getCartProofEnvironment() }
        );
        maxAge = cartSessionCookieMaxAge(expiry);
        if (maxAge > 0) {
          sessionToken = await renewChatwootSessionCapability({
            binding: cartContext.binding,
            sessionToken: input.sessionToken,
            previousState: cartContext.state,
            nextState: {
              ...cartContext.state,
              cartSessionSha256: hashCartSessionProof(proof),
              cartVersion: liveCartVersion,
            },
          });
        }
      } catch {
        proof = null;
        sessionToken = null;
        maxAge = 0;
      }
    }
  }

  const response = NextResponse.json(
    {
      accepted: true,
      ...(liveCartVersion !== null ? { cartVersion: liveCartVersion } : {}),
      operationId: result.operationId,
      replayed: result.replayed,
      ...(sessionToken ? { sessionToken } : {}),
    },
    { headers: NO_STORE_HEADERS }
  );
  if (proof && sessionToken && maxAge > 0) {
    setCartSessionCookie(response, cartContext.state.merchantId, proof, maxAge);
  }
  return response;
}
