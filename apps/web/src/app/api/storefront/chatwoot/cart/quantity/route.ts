import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import {
  loadLiveGrantOperations,
  upgradeLegacySessionPrincipal,
} from '@/lib/cart/grant-operations';
import { readCartJsonBody } from '@/lib/cart/request-context';
import { checkCartQuota } from '@/lib/cart/request-quota';
import { setCartSessionCookie } from '@/lib/cart/response';
import { createCartScopedClient } from '@/lib/cart/scoped-client';
import { mutateCart } from '@/lib/cart/service';
import {
  cartSessionCookieMaxAge,
  issueCartSessionProof,
} from '@/lib/cart/session-proof';
import { loadChatwootCartContext } from '@/lib/chatwoot/cart-context';
import { verifyChatwootSessionCapability } from '@/lib/chatwoot/commerce-context';
import { checkCsrfProtection } from '@/lib/csrf';
import { chatwootCartQuantityMutationRequestSchema } from '@/schemas/chatwoot-commerce-context';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

function unavailable(status: number, code: string) {
  return NextResponse.json(
    { accepted: false, code },
    { status, headers: NO_STORE_HEADERS }
  );
}

/** Applies one idempotent quantity edit authorized by a live Chatwoot session. */
export async function POST(request: NextRequest) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) return unavailable(403, 'forbidden');

  const rawBody = await readCartJsonBody(request);
  if (!rawBody.ok) return unavailable(400, 'invalid_request');
  const parsed = chatwootCartQuantityMutationRequestSchema.safeParse(
    rawBody.body
  );
  if (!parsed.success) return unavailable(400, 'invalid_request');

  const cartContext = await loadChatwootCartContext(request);
  if (!cartContext.ok) {
    return unavailable(cartContext.status, cartContext.code);
  }

  let capability: Awaited<ReturnType<typeof verifyChatwootSessionCapability>>;
  try {
    capability = await verifyChatwootSessionCapability({
      binding: cartContext.binding,
      sessionToken: parsed.data.sessionToken,
      state: cartContext.state,
    });
  } catch {
    return unavailable(403, 'invalid_context');
  }
  if (capability.conversationId !== parsed.data.conversationId) {
    return unavailable(403, 'invalid_context');
  }

  // A current-version edit must match the canonical line and quantity that
  // the shopper reviewed. Older versions are sent to the atomic mutation RPC
  // so an exact operation replay can succeed; a new stale command conflicts.
  if (parsed.data.cartVersion > cartContext.cart.version) {
    return unavailable(409, 'refresh_required');
  }
  if (parsed.data.cartVersion === cartContext.cart.version) {
    const line = cartContext.cart.lines.find(
      (candidate) => candidate.id === parsed.data.lineId
    );
    if (!line || line.quantity !== parsed.data.expectedQuantity) {
      return unavailable(409, 'refresh_required');
    }
  }

  let quota: Awaited<ReturnType<typeof checkCartQuota>>;
  try {
    quota = await checkCartQuota({
      merchantId: cartContext.state.merchantId,
      operation: 'commands',
      subject: cartContext.principal.principalId,
    });
  } catch {
    return unavailable(503, 'temporarily_unavailable');
  }
  if (!quota.allowed) return unavailable(429, 'quota_exceeded');

  const client = createCartScopedClient(cartContext.principal);
  let principal: typeof cartContext.principal | null;
  try {
    principal = await upgradeLegacySessionPrincipal(
      client,
      cartContext.principal
    );
  } catch {
    return unavailable(503, 'temporarily_unavailable');
  }
  if (!principal) return unavailable(503, 'temporarily_unavailable');

  const result = await mutateCart(
    {
      client,
      principal,
    },
    {
      command:
        parsed.data.quantity === 0
          ? { lineId: parsed.data.lineId, type: 'remove' }
          : {
              lineId: parsed.data.lineId,
              quantity: parsed.data.quantity,
              type: 'set_quantity',
            },
      expectedVersion: parsed.data.cartVersion,
      operationId: parsed.data.requestId,
    }
  );
  if (!result.ok) {
    const status =
      result.code === 'version_conflict' ||
      result.code === 'idempotency_conflict'
        ? 409
        : result.code === 'unauthorized'
          ? 403
          : result.code === 'invalid_item'
            ? 400
            : 503;
    return unavailable(
      status,
      status === 409 ? 'refresh_required' : 'temporarily_unavailable'
    );
  }

  const response = NextResponse.json(
    {
      accepted: true,
      cartVersion: result.cart.version,
      operationId: result.operationId,
      replayed: result.replayed,
    },
    { headers: NO_STORE_HEADERS }
  );
  let liveGrant: Awaited<ReturnType<typeof loadLiveGrantOperations>> = null;
  try {
    liveGrant = await loadLiveGrantOperations(client, principal);
  } catch {
    // Retain the incoming proof's expiry when live grant refresh is unavailable.
  }
  const proofGrantExpiry = liveGrant
    ? Date.parse(liveGrant.grantExpiresAt) < Date.parse(result.cart.expiresAt)
      ? liveGrant.grantExpiresAt
      : result.cart.expiresAt
    : principal.expiresAt;
  let proof: string | null = null;
  try {
    proof = issueCartSessionProof(
      {
        allowedOperations:
          liveGrant?.allowedOperations ?? principal.allowedOperations,
        cartId: principal.cartId,
        grantId: principal.grantId,
        grantExpiresAt: proofGrantExpiry,
        merchantId: cartContext.state.merchantId,
        principalId: principal.principalId,
        scope: 'session',
      },
      { environment: getCartProofEnvironment() }
    );
  } catch (error) {
    console.error('Chatwoot cart proof reissue failed after commit', {
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
  const maxAge = cartSessionCookieMaxAge(proofGrantExpiry);
  if (proof && maxAge > 0) {
    setCartSessionCookie(response, cartContext.state.merchantId, proof, maxAge);
  }
  return response;
}
