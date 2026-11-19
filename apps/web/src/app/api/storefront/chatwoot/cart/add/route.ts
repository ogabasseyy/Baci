import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { readCartJsonBody } from '@/lib/cart/request-context';
import { checkCartQuota } from '@/lib/cart/request-quota';
import { loadChatwootCartContext } from '@/lib/chatwoot/cart-context';
import {
  ChatwootCommerceContextError,
  verifyChatwootSessionCapability,
} from '@/lib/chatwoot/commerce-context';
import { commitChatwootCartAdd } from '@/lib/chatwoot/commit-cart-add';
import { checkCsrfProtection } from '@/lib/csrf';
import { chatwootCartAddMutationRequestSchema } from '@/schemas/chatwoot-cart-add-mutation-request';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

function unavailable(status: number, code: string) {
  return NextResponse.json(
    { accepted: false, code },
    { status, headers: NO_STORE_HEADERS }
  );
}

/** Adds one merchant-resolved catalog variant to the verified shared cart. */
export async function POST(request: NextRequest) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) return unavailable(403, 'forbidden');

  const rawBody = await readCartJsonBody(request);
  if (!rawBody.ok) return unavailable(400, 'invalid_request');
  const parsed = chatwootCartAddMutationRequestSchema.safeParse(rawBody.body);
  if (!parsed.success) return unavailable(400, 'invalid_request');

  // Match the sibling quantity route: bounded JSON and Zod first, then the
  // trusted tenant/cart proof context before any catalog mutation work.
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

  return commitChatwootCartAdd({
    cartContext,
    cartVersion: parsed.data.cartVersion,
    operationId: parsed.data.requestId,
    productSlug: parsed.data.productSlug,
    sessionToken: parsed.data.sessionToken,
    variantId: parsed.data.variantId,
  });
}
