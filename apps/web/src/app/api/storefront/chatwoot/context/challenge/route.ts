import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { readCartJsonBody } from '@/lib/cart/request-context';
import { loadChatwootCartContext } from '@/lib/chatwoot/cart-context';
import {
  CHATWOOT_CHALLENGE_TTL_SECONDS,
  ChatwootCommerceContextError,
  getFixedChatwootPlatformOrigin,
  issueChatwootCommerceChallenge,
} from '@/lib/chatwoot/commerce-context';
import { checkCsrfProtection } from '@/lib/csrf';
import { chatwootCommerceChallengeRequestSchema } from '@/schemas/chatwoot-commerce-context';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

function unavailable(status: number, code: string) {
  return NextResponse.json(
    { error: 'Chat context unavailable', code },
    { status, headers: NO_STORE_HEADERS }
  );
}

export async function POST(request: NextRequest) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return csrf.response ?? unavailable(403, 'forbidden');
  }

  const rawBody = await readCartJsonBody(request);
  if (!rawBody.ok) return unavailable(400, 'invalid_request');
  const parsed = chatwootCommerceChallengeRequestSchema.safeParse(rawBody.body);
  if (!parsed.success) return unavailable(400, 'invalid_request');

  const cartContext = await loadChatwootCartContext(request);
  if (!cartContext.ok) {
    return unavailable(cartContext.status, cartContext.code);
  }

  const { conversationId, requestId, visitorTokenSha256, websiteToken } =
    parsed.data;
  if (websiteToken !== cartContext.binding.websiteToken) {
    return unavailable(403, 'binding_mismatch');
  }

  try {
    const issuedAt = Math.floor(Date.now() / 1000);
    const challengeToken = await issueChatwootCommerceChallenge(
      {
        ...cartContext.state,
        conversationId,
        requestId,
        visitorTokenSha256,
      },
      { now: new Date(issuedAt * 1000) }
    );
    const expiresAt = issuedAt + CHATWOOT_CHALLENGE_TTL_SECONDS;
    return NextResponse.json(
      {
        challengeToken,
        expiresAt,
        requestId,
        widgetOrigin: getFixedChatwootPlatformOrigin(),
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    if (error instanceof ChatwootCommerceContextError) {
      const status =
        error.code === 'invalid_config'
          ? 503
          : error.code === 'invalid_challenge'
            ? 400
            : error.code === 'disabled'
              ? 404
              : 403;
      return unavailable(status, error.code);
    }
    return unavailable(503, 'temporarily_unavailable');
  }
}
