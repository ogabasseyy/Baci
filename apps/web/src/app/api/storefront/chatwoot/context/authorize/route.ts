import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { readCartJsonBody } from '@/lib/cart/request-context';
import { loadChatwootCartContext } from '@/lib/chatwoot/cart-context';
import {
  ChatwootCommerceContextError,
  verifyChatwootSessionCapability,
} from '@/lib/chatwoot/commerce-context';
import { checkCsrfProtection } from '@/lib/csrf';
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

  const cartContext = await loadChatwootCartContext(request);
  if (!cartContext.ok) {
    return unavailable(cartContext.status, cartContext.code);
  }

  try {
    const authorized = await verifyChatwootSessionCapability({
      binding: cartContext.binding,
      sessionToken: parsed.data.sessionToken,
      state: cartContext.state,
    });
    return NextResponse.json(
      { authorized: true, ...authorized },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    if (error instanceof ChatwootCommerceContextError) {
      const status = error.code === 'invalid_config' ? 503 : 403;
      return unavailable(status, error.code);
    }
    return unavailable(503, 'temporarily_unavailable');
  }
}
