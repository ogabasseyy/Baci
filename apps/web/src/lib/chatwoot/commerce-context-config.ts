import 'server-only';

import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import {
  CHATWOOT_BINDING_UUID_PATTERN,
  CHATWOOT_BINDING_WEBSITE_TOKEN_PATTERN,
  type ChatwootTenantBinding,
  normalizeHttpsOrigin,
  parseChatwootTenantBindings,
} from './commerce-context-bindings';

export type { ChatwootTenantBinding } from './commerce-context-bindings';
export { normalizeHttpsOrigin } from './commerce-context-bindings';

export const CHATWOOT_CHALLENGE_SCOPE = 'chatwoot-ekaette-commerce-context';
export const CHATWOOT_CONTEXT_AUDIENCE = 'baci-ekaette-commerce-context';
export const CHATWOOT_SESSION_AUDIENCE = 'baci-ekaette-chatwoot-session';
export const CHATWOOT_CHALLENGE_TTL_SECONDS = 90;
export const CHATWOOT_CONTEXT_TTL_SECONDS = 60;
export const CHATWOOT_SESSION_TTL_SECONDS = 600;

export const TOKEN_MAX_LENGTH = 12_000;
export const UUID_PATTERN = CHATWOOT_BINDING_UUID_PATTERN;
export const HEX_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
export const WEBSITE_TOKEN_PATTERN = CHATWOOT_BINDING_WEBSITE_TOKEN_PATTERN;

export type ChatwootCommerceContextState = {
  merchantId: string;
  origin: string;
  websiteToken: string;
  inboxId: number;
  cartId: string;
  cartVersion: number;
  grantId: string;
  principalId: string;
  cartSessionSha256: string;
};

export type ChatwootCommerceChallengeInput = ChatwootCommerceContextState & {
  conversationId: number;
  requestId: string;
  visitorTokenSha256: string;
};

export class ChatwootCommerceContextError extends Error {
  constructor(
    readonly code:
      | 'disabled'
      | 'invalid_config'
      | 'binding_unavailable'
      | 'invalid_challenge'
      | 'invalid_context'
      | 'replayed_context'
      | 'replay_store_unavailable'
  ) {
    super(code);
    this.name = 'ChatwootCommerceContextError';
  }
}

function readBindings(raw: string | undefined): ChatwootTenantBinding[] {
  const bindings = parseChatwootTenantBindings(raw);
  if (!bindings) throw new ChatwootCommerceContextError('invalid_config');
  return bindings;
}

export function getChatwootTenantBinding(
  merchantId: string,
  env: NodeJS.ProcessEnv = process.env
): ChatwootTenantBinding {
  if (env.EKAETTE_CHATWOOT_CONTEXT_ENABLED !== 'true') {
    throw new ChatwootCommerceContextError('disabled');
  }
  const normalizedMerchantId = merchantId.toLowerCase();
  const match = readBindings(env.EKAETTE_CHATWOOT_CONTEXT_BINDINGS).find(
    (binding) => binding.merchantId === normalizedMerchantId
  );
  if (!match) {
    throw new ChatwootCommerceContextError('binding_unavailable');
  }
  return match;
}

export function getFixedChatwootPlatformOrigin(
  env: NodeJS.ProcessEnv = process.env
): string {
  const origin = normalizeHttpsOrigin(
    requiredEnv('EKAETTE_CHATWOOT_PLATFORM_ORIGIN', env)
  );
  if (!origin) throw new ChatwootCommerceContextError('invalid_config');
  return origin;
}

export function requiredEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();
  if (!value) throw new ChatwootCommerceContextError('invalid_config');
  return value;
}

export function rsaModulusLength(pem: string, privateKey: boolean): number {
  try {
    const key = privateKey ? createPrivateKey(pem) : createPublicKey(pem);
    if (key.asymmetricKeyType !== 'rsa') {
      throw new ChatwootCommerceContextError('invalid_config');
    }
    const modulusLength = key.asymmetricKeyDetails?.modulusLength ?? 0;
    if (modulusLength < 2048) {
      throw new ChatwootCommerceContextError('invalid_config');
    }
    return modulusLength;
  } catch (error) {
    if (error instanceof ChatwootCommerceContextError) throw error;
    throw new ChatwootCommerceContextError('invalid_config');
  }
}

export function challengeIssuer(env: NodeJS.ProcessEnv): string {
  const issuer = requiredEnv('EKAETTE_CHATWOOT_CHALLENGE_ISSUER', env);
  if (!normalizeHttpsOrigin(issuer)) {
    throw new ChatwootCommerceContextError('invalid_config');
  }
  return issuer.replace(/\/$/, '');
}

export function challengePrivateKeyPem(env: NodeJS.ProcessEnv): string {
  const pem = requiredEnv(
    'EKAETTE_CHATWOOT_CHALLENGE_PRIVATE_KEY',
    env
  ).replace(/\\n/g, '\n');
  if (!pem.startsWith('-----BEGIN PRIVATE KEY-----')) {
    throw new ChatwootCommerceContextError('invalid_config');
  }
  rsaModulusLength(pem, true);
  return pem;
}

export function challengePublicKeyPem(env: NodeJS.ProcessEnv): string {
  const pem = challengePrivateKeyPem(env);
  try {
    return createPublicKey(createPrivateKey(pem))
      .export({ format: 'pem', type: 'spki' })
      .toString();
  } catch {
    throw new ChatwootCommerceContextError('invalid_config');
  }
}

export function requireStringClaim(
  payload: Record<string, unknown>,
  name: string
): string {
  const value = payload[name];
  if (typeof value !== 'string') {
    throw new ChatwootCommerceContextError('invalid_context');
  }
  return value;
}

export function requireNumberClaim(
  payload: Record<string, unknown>,
  name: string
): number {
  const value = payload[name];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ChatwootCommerceContextError('invalid_context');
  }
  return value;
}

export function hashCartSessionProof(proof: string): string {
  return createHash('sha256').update(proof, 'utf8').digest('hex');
}
