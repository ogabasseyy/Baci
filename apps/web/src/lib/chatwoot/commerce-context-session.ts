import 'server-only';

import { randomBytes } from 'node:crypto';
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';
import {
  CHATWOOT_SESSION_AUDIENCE,
  CHATWOOT_SESSION_TTL_SECONDS,
  ChatwootCommerceContextError,
  type ChatwootCommerceContextState,
  type ChatwootTenantBinding,
  challengeIssuer,
  challengePrivateKeyPem,
  challengePublicKeyPem,
  HEX_DIGEST_PATTERN,
  requireNumberClaim,
  requireStringClaim,
  TOKEN_MAX_LENGTH,
} from './commerce-context-config';

export type VerifiedChatwootSessionCapability = {
  conversationId: number;
  sessionExpiresAt: number;
  visitorTokenSha256: string;
};

async function verifySessionCapability(
  input: {
    sessionToken: string;
    state: ChatwootCommerceContextState;
    binding: ChatwootTenantBinding;
    env?: NodeJS.ProcessEnv;
    now?: Date;
  },
  allowPriorProofHash: boolean
): Promise<VerifiedChatwootSessionCapability> {
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
  const sessionProofHash = requireStringClaim(payload, 'cart_session_sha256');
  if (
    requireStringClaim(payload, 'scope') !== 'chatwoot-commerce-session' ||
    requireStringClaim(payload, 'jti').length < 32 ||
    issuedAt > nowSeconds + 5 ||
    sessionExpiresAt <= nowSeconds ||
    sessionExpiresAt <= issuedAt ||
    sessionExpiresAt - issuedAt > CHATWOOT_SESSION_TTL_SECONDS ||
    input.state.merchantId !== input.binding.merchantId ||
    input.state.origin !== input.binding.origin ||
    input.state.websiteToken !== input.binding.websiteToken ||
    input.state.inboxId !== input.binding.inboxId ||
    requireStringClaim(payload, 'merchant_id') !== input.state.merchantId ||
    requireStringClaim(payload, 'origin') !== input.state.origin ||
    requireStringClaim(payload, 'website_token') !==
      input.binding.websiteToken ||
    requireNumberClaim(payload, 'inbox_id') !== input.binding.inboxId ||
    requireStringClaim(payload, 'cart_id') !== input.state.cartId ||
    !HEX_DIGEST_PATTERN.test(sessionProofHash) ||
    (!allowPriorProofHash &&
      sessionProofHash !== input.state.cartSessionSha256) ||
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
  return {
    conversationId,
    sessionExpiresAt,
    visitorTokenSha256: requireStringClaim(payload, 'visitor_token_sha256'),
  };
}

export function verifyChatwootSessionCapability(input: {
  sessionToken: string;
  state: ChatwootCommerceContextState;
  binding: ChatwootTenantBinding;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}) {
  return verifySessionCapability(input, false);
}

/** Recovers a lost renewal response using the current browser cart proof. */
export async function rebindChatwootSessionCapability(input: {
  sessionToken: string;
  state: ChatwootCommerceContextState;
  binding: ChatwootTenantBinding;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<{
  conversationId: number;
  sessionExpiresAt: number;
  sessionToken: string;
}> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const capability = await verifySessionCapability(input, true);
  const sessionToken = await issueCapabilityForState({
    capability,
    state: input.state,
    binding: input.binding,
    env,
    now,
  });
  return {
    conversationId: capability.conversationId,
    sessionExpiresAt: capability.sessionExpiresAt,
    sessionToken,
  };
}

async function issueCapabilityForState(input: {
  capability: VerifiedChatwootSessionCapability;
  state: ChatwootCommerceContextState;
  binding: ChatwootTenantBinding;
  env: NodeJS.ProcessEnv;
  now: Date;
}): Promise<string> {
  const nowSeconds = Math.floor(input.now.getTime() / 1000);
  const remainingSeconds = input.capability.sessionExpiresAt - nowSeconds;
  if (
    remainingSeconds <= 0 ||
    remainingSeconds > CHATWOOT_SESSION_TTL_SECONDS ||
    !HEX_DIGEST_PATTERN.test(input.capability.visitorTokenSha256) ||
    !HEX_DIGEST_PATTERN.test(input.state.cartSessionSha256) ||
    !Number.isSafeInteger(input.state.cartVersion)
  ) {
    throw new ChatwootCommerceContextError('invalid_context');
  }
  const privateKey = await importPKCS8(
    challengePrivateKeyPem(input.env),
    'RS256'
  );
  return new SignJWT({
    cart_id: input.state.cartId,
    cart_session_sha256: input.state.cartSessionSha256,
    cart_version_at_issue: input.state.cartVersion,
    conversation_id: input.capability.conversationId,
    grant_id: input.state.grantId,
    inbox_id: input.binding.inboxId,
    merchant_id: input.state.merchantId,
    origin: input.state.origin,
    principal_id: input.state.principalId,
    scope: 'chatwoot-commerce-session',
    website_token: input.binding.websiteToken,
    visitor_token_sha256: input.capability.visitorTokenSha256,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(challengeIssuer(input.env))
    .setAudience(CHATWOOT_SESSION_AUDIENCE)
    .setIssuedAt(nowSeconds)
    .setNotBefore(nowSeconds)
    .setExpirationTime(input.capability.sessionExpiresAt)
    .setJti(randomBytes(24).toString('base64url'))
    .sign(privateKey);
}

/** Rebinds a verified capability to a proof renewed by this same cart action. */
export async function renewChatwootSessionCapability(input: {
  sessionToken: string;
  previousState: ChatwootCommerceContextState;
  nextState: ChatwootCommerceContextState;
  binding: ChatwootTenantBinding;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<string> {
  const env = input.env ?? process.env;
  const capability = await verifyChatwootSessionCapability({
    sessionToken: input.sessionToken,
    state: input.previousState,
    binding: input.binding,
    env,
    now: input.now,
  });
  const now = input.now ?? new Date();
  if (
    input.nextState.merchantId !== input.previousState.merchantId ||
    input.nextState.origin !== input.previousState.origin ||
    input.nextState.websiteToken !== input.previousState.websiteToken ||
    input.nextState.inboxId !== input.previousState.inboxId ||
    input.nextState.cartId !== input.previousState.cartId ||
    input.nextState.grantId !== input.previousState.grantId ||
    input.nextState.principalId !== input.previousState.principalId ||
    input.nextState.cartVersion < input.previousState.cartVersion
  ) {
    throw new ChatwootCommerceContextError('invalid_context');
  }
  return issueCapabilityForState({
    capability,
    state: input.nextState,
    binding: input.binding,
    env,
    now,
  });
}
