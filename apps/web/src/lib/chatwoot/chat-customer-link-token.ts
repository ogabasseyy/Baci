import 'server-only';

import { importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';
import { CHAT_CUSTOMER_LINK_ATTRIBUTE } from '@/schemas/chat-customer-link';
import {
  challengeIssuer,
  challengePrivateKeyPem,
  challengePublicKeyPem,
  TOKEN_MAX_LENGTH,
  UUID_PATTERN,
} from './commerce-context-config';

/**
 * A signed note, made when a signed-in shopper opens the store chat, saying
 * "this browser belongs to customer X of store Y". The chat widget stores it
 * on the shopper's contact; the merchant inbox verifies it before showing
 * order history. Anyone can write to a contact, but only this server can sign,
 * so a forged or edited value never verifies.
 *
 * It reuses the chat engine's existing signing key under its own audience and
 * scope, so no other token of that key is accepted here (and the reverse).
 */
export { CHAT_CUSTOMER_LINK_ATTRIBUTE };
export const CHAT_CUSTOMER_LINK_AUDIENCE = 'baci-chat-customer-link';
const CHAT_CUSTOMER_LINK_SCOPE = 'chat-customer-link';
const CHAT_CUSTOMER_LINK_TTL_SECONDS = 90 * 24 * 60 * 60;

export type VerifiedChatCustomerLink = {
  merchantId: string;
  customerId: string;
};

export async function issueChatCustomerLinkToken(
  input: { merchantId: string; customerId: string },
  options: { env?: NodeJS.ProcessEnv; now?: Date } = {}
): Promise<string | null> {
  const env = options.env ?? process.env;
  if (
    !UUID_PATTERN.test(input.merchantId) ||
    !UUID_PATTERN.test(input.customerId)
  ) {
    return null;
  }
  try {
    const key = await importPKCS8(challengePrivateKeyPem(env), 'RS256');
    const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1000);
    return await new SignJWT({
      scope: CHAT_CUSTOMER_LINK_SCOPE,
      merchant_id: input.merchantId.toLowerCase(),
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(challengeIssuer(env))
      .setAudience(CHAT_CUSTOMER_LINK_AUDIENCE)
      .setSubject(input.customerId.toLowerCase())
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + CHAT_CUSTOMER_LINK_TTL_SECONDS)
      .sign(key);
  } catch {
    // Missing or malformed signing configuration: the feature stays off.
    return null;
  }
}

/**
 * Returns a verifier bound to one store, or null when signing is not
 * configured. The key is imported once so a whole page of chats is cheap.
 */
export async function createChatCustomerLinkVerifier(
  merchantId: string,
  options: { env?: NodeJS.ProcessEnv; now?: Date } = {}
): Promise<
  ((token: unknown) => Promise<VerifiedChatCustomerLink | null>) | null
> {
  const env = options.env ?? process.env;
  let key: Awaited<ReturnType<typeof importSPKI>>;
  let issuer: string;
  try {
    key = await importSPKI(challengePublicKeyPem(env), 'RS256');
    issuer = challengeIssuer(env);
  } catch {
    return null;
  }
  const wanted = merchantId.toLowerCase();
  return async (token) => {
    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      token.length > TOKEN_MAX_LENGTH
    ) {
      return null;
    }
    try {
      const { payload } = await jwtVerify(token, key, {
        algorithms: ['RS256'],
        audience: CHAT_CUSTOMER_LINK_AUDIENCE,
        issuer,
        currentDate: options.now,
      });
      if (
        payload.scope !== CHAT_CUSTOMER_LINK_SCOPE ||
        payload.merchant_id !== wanted ||
        typeof payload.sub !== 'string' ||
        !UUID_PATTERN.test(payload.sub)
      ) {
        return null;
      }
      return { merchantId: wanted, customerId: payload.sub };
    } catch {
      return null;
    }
  };
}
