import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import { resolveChatwootCartProofExpiry } from '@/lib/cart/chatwoot-proof-expiry';
import {
  loadLiveGrantOperations,
  upgradeLegacySessionPrincipal,
} from '@/lib/cart/grant-operations';
import { readCartJsonBody } from '@/lib/cart/request-context';
import { checkCartQuota } from '@/lib/cart/request-quota';
import { setCartSessionCookie } from '@/lib/cart/response';
import { createCartScopedClient } from '@/lib/cart/scoped-client';
import { getCart, mutateCart } from '@/lib/cart/service';
import {
  cartSessionCookieMaxAge,
  issueCartSessionProof,
} from '@/lib/cart/session-proof';
import { loadChatwootCartContext } from '@/lib/chatwoot/cart-context';
import {
  ChatwootCommerceContextError,
  hashCartSessionProof,
  renewChatwootSessionCapability,
  verifyChatwootSessionCapability,
} from '@/lib/chatwoot/commerce-context';
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

  let cartContext: Awaited<ReturnType<typeof loadChatwootCartContext>>;
  try {
    cartContext = await loadChatwootCartContext(request);
  } catch {
    return unavailable(503, 'temporarily_unavailable');
  }
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
  } catch (error) {
    if (error instanceof ChatwootCommerceContextError) {
      const status = error.code === 'invalid_config' ? 503 : 403;
      return unavailable(
        status,
        status === 503 ? 'temporarily_unavailable' : 'invalid_context'
      );
    }
    return unavailable(503, 'temporarily_unavailable');
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
  if (!principal) return unavailable(503, 'temporarily_unavailable');

  let result: Awaited<ReturnType<typeof mutateCart>>;
  try {
    result = await mutateCart(
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
  } catch {
    return unavailable(503, 'temporarily_unavailable');
  }
  if (!result.ok) {
    const status =
      result.code === 'version_conflict' ||
      result.code === 'idempotency_conflict' ||
      result.code === 'cart_locked' ||
      result.code === 'expired' ||
      result.code === 'not_found'
        ? 409
        : result.code === 'unauthorized'
          ? 403
          : result.code === 'invalid_item'
            ? 400
            : 503;
    const code =
      status === 409
        ? 'refresh_required'
        : status === 400
          ? 'invalid_request'
          : status === 403
            ? 'forbidden'
            : 'temporarily_unavailable';
    return unavailable(status, code);
  }

  let liveGrant: Awaited<ReturnType<typeof loadLiveGrantOperations>> = null;
  try {
    liveGrant = await loadLiveGrantOperations(client, principal);
  } catch {
    console.error('Chatwoot live grant refresh failed after cart mutation');
  }
  const reportedCartVersion = result.currentVersion;
  let liveCartVersion =
    typeof reportedCartVersion === 'number' &&
    Number.isSafeInteger(reportedCartVersion) &&
    reportedCartVersion >= result.cart.version &&
    reportedCartVersion >= cartContext.state.cartVersion
      ? reportedCartVersion
      : !result.replayed && result.cart.version >= cartContext.state.cartVersion
        ? result.cart.version
        : null;
  let proofCartExpiresAt = result.cart.expiresAt;
  let canRenewProof = true;
  if (result.replayed) {
    let latestCart: Awaited<ReturnType<typeof getCart>> | null = null;
    try {
      latestCart = await getCart({ client, principal });
    } catch {
      canRenewProof = false;
    }
    if (canRenewProof) {
      if (
        !latestCart?.ok ||
        latestCart.cart.cartId !== principal.cartId ||
        latestCart.cart.merchantId !== cartContext.state.merchantId ||
        latestCart.cart.version < cartContext.state.cartVersion ||
        (liveCartVersion !== null && latestCart.cart.version < liveCartVersion)
      ) {
        canRenewProof = false;
      } else {
        liveCartVersion = latestCart.cart.version;
        proofCartExpiresAt = latestCart.cart.expiresAt;
      }
    }
    if (!canRenewProof) liveCartVersion = null;
  }
  if (liveCartVersion === null) {
    canRenewProof = false;
  }

  const proofGrantExpiry =
    canRenewProof && liveGrant
      ? resolveChatwootCartProofExpiry({
          cartExpiresAt: proofCartExpiresAt,
          existingProofExpiresAt: principal.expiresAt,
          liveGrantExpiresAt: liveGrant.grantExpiresAt,
        })
      : null;
  let proof: string | null = null;
  if (proofGrantExpiry !== null && liveGrant !== null) {
    try {
      proof = issueCartSessionProof(
        {
          allowedOperations: liveGrant.allowedOperations,
          cartId: principal.cartId,
          grantId: principal.grantId,
          grantExpiresAt: proofGrantExpiry,
          merchantId: cartContext.state.merchantId,
          principalId: principal.principalId,
          scope: 'session',
        },
        { environment: getCartProofEnvironment() }
      );
    } catch {
      console.error('Chatwoot cart proof reissue failed after commit');
    }
  }
  const maxAge = proofGrantExpiry
    ? cartSessionCookieMaxAge(proofGrantExpiry)
    : 0;
  let sessionToken: string | null = null;
  if (
    proof &&
    maxAge > 0 &&
    proofGrantExpiry !== null &&
    liveCartVersion !== null
  ) {
    try {
      sessionToken = await renewChatwootSessionCapability({
        binding: cartContext.binding,
        sessionToken: parsed.data.sessionToken,
        previousState: cartContext.state,
        nextState: {
          ...cartContext.state,
          cartSessionSha256: hashCartSessionProof(proof),
          cartVersion: liveCartVersion,
        },
      });
    } catch {
      console.error('Chatwoot session renewal failed after cart commit');
    }
  }
  // An idempotent replay stays accepted when the live-cart read fails; only
  // include cartVersion when the current version was independently verified.
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
  // Keep the old proof in place if capability rebinding failed after commit;
  // the old session remains usable and an idempotent retry can recover.
  if (proof && sessionToken && maxAge > 0 && proofGrantExpiry !== null) {
    setCartSessionCookie(response, cartContext.state.merchantId, proof, maxAge);
  }
  return response;
}
