import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { readCartJsonBody } from '@/lib/cart/request-context';
import { loadChatwootCartContext } from '@/lib/chatwoot/cart-context';
import { projectChatwootCartReview } from '@/lib/chatwoot/cart-review-projection';
import {
  ChatwootCommerceContextError,
  rebindChatwootSessionCapability,
  verifyChatwootSessionCapability,
} from '@/lib/chatwoot/commerce-context';
import { checkCsrfProtection } from '@/lib/csrf';
import { chatwootCartReviewSnapshotSchema } from '@/schemas/chatwoot-cart-review-snapshot';
import { chatwootCommerceSessionAuthorizeRequestSchema } from '@/schemas/chatwoot-commerce-context';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

function unavailable(status: number, code: string) {
  return NextResponse.json(
    { error: 'Chat context unavailable', code },
    { status, headers: NO_STORE_HEADERS }
  );
}

export async function POST(request: NextRequest) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) return csrf.response ?? unavailable(403, 'forbidden');

  const rawBody = await readCartJsonBody(request);
  if (!rawBody.ok) return unavailable(400, 'invalid_request');
  const parsed = chatwootCommerceSessionAuthorizeRequestSchema.safeParse(
    rawBody.body
  );
  if (!parsed.success) return unavailable(400, 'invalid_request');
  const includeCartSnapshot = parsed.data.includeCartSnapshot === true;

  const cartContext = await loadChatwootCartContext(request, {
    includeProductNames: includeCartSnapshot,
  });
  if (!cartContext.ok) {
    return unavailable(cartContext.status, cartContext.code);
  }

  try {
    let authorized: {
      conversationId: number;
      sessionExpiresAt: number;
    };
    let renewedSessionToken: string | undefined;
    try {
      authorized = await verifyChatwootSessionCapability({
        binding: cartContext.binding,
        sessionToken: parsed.data.sessionToken,
        state: cartContext.state,
      });
    } catch (error) {
      if (
        !(error instanceof ChatwootCommerceContextError) ||
        error.code !== 'invalid_context'
      ) {
        throw error;
      }
      const rebound = await rebindChatwootSessionCapability({
        binding: cartContext.binding,
        sessionToken: parsed.data.sessionToken,
        state: cartContext.state,
      });
      authorized = rebound;
      renewedSessionToken = rebound.sessionToken;
    }
    const response = {
      authorized: true,
      conversationId: authorized.conversationId,
      sessionExpiresAt: authorized.sessionExpiresAt,
      ...(renewedSessionToken ? { sessionToken: renewedSessionToken } : {}),
    };
    if (includeCartSnapshot) {
      const projectedCartSnapshot = projectChatwootCartReview(
        cartContext.cart,
        cartContext.productNames
      );
      const parsedCartSnapshot = chatwootCartReviewSnapshotSchema.safeParse(
        projectedCartSnapshot
      );
      if (!parsedCartSnapshot.success) {
        return unavailable(503, 'temporarily_unavailable');
      }
      return NextResponse.json(
        { ...response, cartSnapshot: parsedCartSnapshot.data },
        { headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json(response, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof ChatwootCommerceContextError) {
      const status = error.code === 'invalid_config' ? 503 : 403;
      return unavailable(status, error.code);
    }
    return unavailable(503, 'temporarily_unavailable');
  }
}
