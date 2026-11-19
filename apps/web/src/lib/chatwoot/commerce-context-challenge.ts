import 'server-only';

import { randomBytes } from 'node:crypto';
import { importPKCS8, SignJWT } from 'jose';
import {
  CHATWOOT_CHALLENGE_SCOPE,
  CHATWOOT_CHALLENGE_TTL_SECONDS,
  type ChatwootCommerceChallengeInput,
  ChatwootCommerceContextError,
  challengeIssuer,
  challengePrivateKeyPem,
  getChatwootTenantBinding,
  HEX_DIGEST_PATTERN,
  normalizeHttpsOrigin,
  REQUEST_ID_PATTERN,
  UUID_PATTERN,
  WEBSITE_TOKEN_PATTERN,
} from './commerce-context-config';

function validateChallengeInput(input: ChatwootCommerceChallengeInput) {
  if (
    !UUID_PATTERN.test(input.merchantId) ||
    !UUID_PATTERN.test(input.cartId) ||
    !UUID_PATTERN.test(input.grantId) ||
    typeof input.principalId !== 'string' ||
    input.principalId.length < 1 ||
    input.principalId.length > 128 ||
    !normalizeHttpsOrigin(input.origin) ||
    !WEBSITE_TOKEN_PATTERN.test(input.websiteToken) ||
    !Number.isSafeInteger(input.inboxId) ||
    input.inboxId <= 0 ||
    !Number.isSafeInteger(input.cartVersion) ||
    input.cartVersion < 0 ||
    !Number.isSafeInteger(input.conversationId) ||
    input.conversationId <= 0 ||
    !REQUEST_ID_PATTERN.test(input.requestId) ||
    !HEX_DIGEST_PATTERN.test(input.visitorTokenSha256) ||
    !HEX_DIGEST_PATTERN.test(input.cartSessionSha256)
  ) {
    throw new ChatwootCommerceContextError('invalid_challenge');
  }
}

export async function issueChatwootCommerceChallenge(
  input: ChatwootCommerceChallengeInput,
  options: { env?: NodeJS.ProcessEnv; now?: Date } = {}
): Promise<string> {
  const env = options.env ?? process.env;
  validateChallengeInput(input);
  const binding = getChatwootTenantBinding(input.merchantId, env);
  if (
    binding.origin !== input.origin ||
    binding.websiteToken !== input.websiteToken ||
    binding.inboxId !== input.inboxId
  ) {
    throw new ChatwootCommerceContextError('binding_unavailable');
  }
  const now = options.now ?? new Date();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const privateKey = await importPKCS8(challengePrivateKeyPem(env), 'RS256');
  return new SignJWT({
    cart_id: input.cartId,
    cart_session_sha256: input.cartSessionSha256,
    cart_version: input.cartVersion,
    conversation_id: input.conversationId,
    grant_id: input.grantId,
    inbox_id: input.inboxId,
    merchant_id: input.merchantId,
    nonce: randomBytes(32).toString('base64url'),
    origin: input.origin,
    principal_id: input.principalId,
    request_id: input.requestId,
    scope: CHATWOOT_CHALLENGE_SCOPE,
    visitor_token_sha256: input.visitorTokenSha256,
    website_token: input.websiteToken,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(challengeIssuer(env))
    .setAudience(`${CHATWOOT_CHALLENGE_SCOPE}:${input.websiteToken}`)
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt)
    .setExpirationTime(issuedAt + CHATWOOT_CHALLENGE_TTL_SECONDS)
    .sign(privateKey);
}
