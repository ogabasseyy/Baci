import 'server-only';

import { randomBytes } from 'node:crypto';
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';
import { getRedis } from '@/lib/redis';
import {
  CHATWOOT_CHALLENGE_SCOPE,
  CHATWOOT_CHALLENGE_TTL_SECONDS,
  CHATWOOT_CONTEXT_AUDIENCE,
  CHATWOOT_CONTEXT_TTL_SECONDS,
  CHATWOOT_SESSION_AUDIENCE,
  CHATWOOT_SESSION_TTL_SECONDS,
  ChatwootCommerceContextError,
  type ChatwootCommerceContextState,
  type ChatwootTenantBinding,
  challengeIssuer,
  challengePrivateKeyPem,
  challengePublicKeyPem,
  HEX_DIGEST_PATTERN,
  NONCE_PATTERN,
  REQUEST_ID_PATTERN,
  requiredEnv,
  requireNumberClaim,
  requireStringClaim,
  rsaModulusLength,
  TOKEN_MAX_LENGTH,
} from './commerce-context-config';

function validateChallengePayload(
  challenge: Record<string, unknown>,
  state: ChatwootCommerceContextState,
  binding: ChatwootTenantBinding,
  nowSeconds: number
) {
  const iat = requireNumberClaim(challenge, 'iat');
  const exp = requireNumberClaim(challenge, 'exp');
  if (
    exp <= nowSeconds ||
    iat > nowSeconds + 5 ||
    exp <= iat ||
    exp - iat > CHATWOOT_CHALLENGE_TTL_SECONDS ||
    requireStringClaim(challenge, 'scope') !== CHATWOOT_CHALLENGE_SCOPE ||
    requireStringClaim(challenge, 'merchant_id') !== state.merchantId ||
    requireStringClaim(challenge, 'origin') !== state.origin ||
    requireStringClaim(challenge, 'website_token') !== binding.websiteToken ||
    requireNumberClaim(challenge, 'inbox_id') !== binding.inboxId ||
    requireStringClaim(challenge, 'cart_id') !== state.cartId ||
    requireNumberClaim(challenge, 'cart_version') !== state.cartVersion ||
    requireStringClaim(challenge, 'grant_id') !== state.grantId ||
    requireStringClaim(challenge, 'principal_id') !== state.principalId ||
    requireStringClaim(challenge, 'cart_session_sha256') !==
      state.cartSessionSha256 ||
    !REQUEST_ID_PATTERN.test(requireStringClaim(challenge, 'request_id')) ||
    !NONCE_PATTERN.test(requireStringClaim(challenge, 'nonce')) ||
    !HEX_DIGEST_PATTERN.test(
      requireStringClaim(challenge, 'visitor_token_sha256')
    )
  ) {
    throw new ChatwootCommerceContextError('invalid_challenge');
  }
  return {
    exp,
    iat,
    nonce: requireStringClaim(challenge, 'nonce'),
    requestId: requireStringClaim(challenge, 'request_id'),
  };
}

async function consumeNonce(
  merchantId: string,
  nonce: string,
  ttl: number
): Promise<void> {
  const redis = getRedis();
  if (!redis)
    throw new ChatwootCommerceContextError('replay_store_unavailable');
  try {
    const result = await redis.set(
      `ekaette:chatwoot-context:v1:${merchantId}:${nonce}`,
      '1',
      { nx: true, ex: Math.max(1, ttl) }
    );
    if (result !== 'OK') {
      throw new ChatwootCommerceContextError('replayed_context');
    }
  } catch (error) {
    if (error instanceof ChatwootCommerceContextError) throw error;
    throw new ChatwootCommerceContextError('replay_store_unavailable');
  }
}

export async function verifyChatwootCommerceContext(input: {
  challengeToken: string;
  contextToken: string;
  state: ChatwootCommerceContextState;
  binding: ChatwootTenantBinding;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  consume?: (merchantId: string, nonce: string, ttl: number) => Promise<void>;
}): Promise<{
  conversationId: number;
  requestId: string;
  sessionToken: string;
  sessionExpiresAt: number;
}> {
  const env = input.env ?? process.env;
  if (
    input.challengeToken.length > TOKEN_MAX_LENGTH ||
    input.contextToken.length > TOKEN_MAX_LENGTH
  ) {
    throw new ChatwootCommerceContextError('invalid_context');
  }
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  let challengePayload: Record<string, unknown>;
  let contextPayload: Record<string, unknown>;
  try {
    const challengeKey = await importSPKI(challengePublicKeyPem(env), 'RS256');
    const challengeResult = await jwtVerify(
      input.challengeToken,
      challengeKey,
      {
        algorithms: ['RS256'],
        audience: `${CHATWOOT_CHALLENGE_SCOPE}:${input.binding.websiteToken}`,
        issuer: challengeIssuer(env),
        currentDate: input.now,
      }
    );
    challengePayload = challengeResult.payload;

    const chatwootPem = requiredEnv(
      'CHATWOOT_EKAETTE_CONTEXT_PUBLIC_KEY',
      env
    ).replace(/\\n/g, '\n');
    if (!chatwootPem.startsWith('-----BEGIN PUBLIC KEY-----')) {
      throw new ChatwootCommerceContextError('invalid_config');
    }
    rsaModulusLength(chatwootPem, false);
    const chatwootKey = await importSPKI(chatwootPem, 'RS256');
    const contextResult = await jwtVerify(input.contextToken, chatwootKey, {
      algorithms: ['RS256'],
      audience: CHATWOOT_CONTEXT_AUDIENCE,
      issuer: requiredEnv('CHATWOOT_EKAETTE_CONTEXT_ISSUER', env),
      currentDate: input.now,
    });
    contextPayload = contextResult.payload;
  } catch (error) {
    if (error instanceof ChatwootCommerceContextError) throw error;
    throw new ChatwootCommerceContextError('invalid_context');
  }

  const challenge = validateChallengePayload(
    challengePayload,
    input.state,
    input.binding,
    nowSeconds
  );
  const contextIat = requireNumberClaim(contextPayload, 'iat');
  const contextExp = requireNumberClaim(contextPayload, 'exp');
  const conversationId = requireNumberClaim(contextPayload, 'conversation_id');
  if (
    contextExp <= nowSeconds ||
    contextIat > nowSeconds + 5 ||
    contextExp <= contextIat ||
    contextExp - contextIat > CHATWOOT_CONTEXT_TTL_SECONDS ||
    contextIat < challenge.iat ||
    contextExp > challenge.exp ||
    requireStringClaim(contextPayload, 'jti') !== challenge.nonce ||
    requireStringClaim(contextPayload, 'request_id') !== challenge.requestId ||
    requireStringClaim(contextPayload, 'merchant_id') !==
      input.state.merchantId ||
    requireStringClaim(contextPayload, 'origin') !== input.state.origin ||
    requireStringClaim(contextPayload, 'website_token') !==
      input.binding.websiteToken ||
    requireNumberClaim(contextPayload, 'inbox_id') !== input.binding.inboxId ||
    requireNumberClaim(contextPayload, 'conversation_id') !==
      requireNumberClaim(challengePayload, 'conversation_id') ||
    requireStringClaim(contextPayload, 'visitor_token_sha256') !==
      requireStringClaim(challengePayload, 'visitor_token_sha256') ||
    requireStringClaim(contextPayload, 'cart_session_sha256') !==
      input.state.cartSessionSha256 ||
    requireStringClaim(contextPayload, 'cart_id') !== input.state.cartId ||
    requireNumberClaim(contextPayload, 'cart_version') !==
      input.state.cartVersion
  ) {
    throw new ChatwootCommerceContextError('invalid_context');
  }

  const ttl = challenge.exp - nowSeconds;
  await (input.consume ?? consumeNonce)(
    input.state.merchantId,
    challenge.nonce,
    ttl
  );
  const sessionExpiresAt = nowSeconds + CHATWOOT_SESSION_TTL_SECONDS;
  const privateKey = await importPKCS8(challengePrivateKeyPem(env), 'RS256');
  const sessionToken = await new SignJWT({
    cart_id: input.state.cartId,
    cart_session_sha256: input.state.cartSessionSha256,
    cart_version_at_issue: input.state.cartVersion,
    conversation_id: conversationId,
    grant_id: input.state.grantId,
    inbox_id: input.binding.inboxId,
    merchant_id: input.state.merchantId,
    origin: input.state.origin,
    principal_id: input.state.principalId,
    scope: 'chatwoot-commerce-session',
    website_token: input.binding.websiteToken,
    visitor_token_sha256: requireStringClaim(
      contextPayload,
      'visitor_token_sha256'
    ),
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(challengeIssuer(env))
    .setAudience(CHATWOOT_SESSION_AUDIENCE)
    .setIssuedAt(nowSeconds)
    .setNotBefore(nowSeconds)
    .setExpirationTime(sessionExpiresAt)
    .setJti(randomBytes(24).toString('base64url'))
    .sign(privateKey);
  return {
    conversationId,
    requestId: challenge.requestId,
    sessionExpiresAt,
    sessionToken,
  };
}
