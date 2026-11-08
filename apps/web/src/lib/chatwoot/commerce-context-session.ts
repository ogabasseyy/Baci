import 'server-only';

import { importSPKI, jwtVerify } from 'jose';
import {
  CHATWOOT_SESSION_AUDIENCE,
  CHATWOOT_SESSION_TTL_SECONDS,
  ChatwootCommerceContextError,
  type ChatwootCommerceContextState,
  type ChatwootTenantBinding,
  challengeIssuer,
  challengePublicKeyPem,
  HEX_DIGEST_PATTERN,
  requireNumberClaim,
  requireStringClaim,
  TOKEN_MAX_LENGTH,
} from './commerce-context-config';

export async function verifyChatwootSessionCapability(input: {
  sessionToken: string;
  state: ChatwootCommerceContextState;
  binding: ChatwootTenantBinding;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<{ conversationId: number; sessionExpiresAt: number }> {
  const env = input.env ?? process.env;
  if (input.sessionToken.length > TOKEN_MAX_LENGTH) {
    throw new ChatwootCommerceContextError('invalid_context');
  }
  let payload: Record<string, unknown>;
  try {
    const key = await importSPKI(challengePublicKeyPem(env), 'RS256');
    const result = await jwtVerify(input.sessionToken, key, {
      algorithms: ['RS256'],
      audience: CHATWOOT_SESSION_AUDIENCE,
      issuer: challengeIssuer(env),
      currentDate: input.now,
    });
    payload = result.payload;
  } catch (error) {
    if (error instanceof ChatwootCommerceContextError) throw error;
    throw new ChatwootCommerceContextError('invalid_context');
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const issuedAt = requireNumberClaim(payload, 'iat');
  const sessionExpiresAt = requireNumberClaim(payload, 'exp');
  const conversationId = requireNumberClaim(payload, 'conversation_id');
  if (
    requireStringClaim(payload, 'scope') !== 'chatwoot-commerce-session' ||
    requireStringClaim(payload, 'jti').length < 32 ||
    issuedAt > nowSeconds + 5 ||
    sessionExpiresAt <= nowSeconds ||
    sessionExpiresAt <= issuedAt ||
    sessionExpiresAt - issuedAt > CHATWOOT_SESSION_TTL_SECONDS ||
    requireStringClaim(payload, 'merchant_id') !== input.state.merchantId ||
    requireStringClaim(payload, 'origin') !== input.state.origin ||
    requireStringClaim(payload, 'website_token') !==
      input.binding.websiteToken ||
    requireNumberClaim(payload, 'inbox_id') !== input.binding.inboxId ||
    requireStringClaim(payload, 'cart_id') !== input.state.cartId ||
    requireStringClaim(payload, 'cart_session_sha256') !==
      input.state.cartSessionSha256 ||
    requireStringClaim(payload, 'grant_id') !== input.state.grantId ||
    requireStringClaim(payload, 'principal_id') !== input.state.principalId ||
    !HEX_DIGEST_PATTERN.test(
      requireStringClaim(payload, 'visitor_token_sha256')
    ) ||
    // Cart versions only move forward within the same bound cart. This floor
    // permits legitimate mutations while rejecting a reset/substituted state.
    !Number.isSafeInteger(
      requireNumberClaim(payload, 'cart_version_at_issue')
    ) ||
    requireNumberClaim(payload, 'cart_version_at_issue') >
      input.state.cartVersion
  ) {
    throw new ChatwootCommerceContextError('invalid_context');
  }
  return { conversationId, sessionExpiresAt };
}
