import {
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from 'jose';
import {
  CHATWOOT_CHALLENGE_SCOPE,
  type ChatwootCommerceChallengeInput,
  type ChatwootCommerceContextState,
  hashCartSessionProof,
  issueChatwootCommerceChallenge,
} from './commerce-context';

export const merchantId = '6df442af-4d21-4f4f-9f0b-607400000001';
export const cartId = '6df442af-4d21-4f4f-9f0b-607400000002';
export const grantId = '6df442af-4d21-4f4f-9f0b-607400000003';
export const principalId = '6df442af-4d21-4f4f-9f0b-607400000004';
export const visitorTokenSha256 = 'b'.repeat(64);
export const cartSessionSha256 = hashCartSessionProof(
  'synthetic-cart-session-proof'
);
export const fixedTime = new Date('2026-11-07T12:00:00.000Z');

export const state: ChatwootCommerceContextState = {
  cartId,
  cartSessionSha256,
  cartVersion: 12,
  grantId,
  inboxId: 74,
  merchantId,
  origin: 'https://shop.example.com',
  principalId,
  websiteToken: 'synthetic-widget-token-123456',
};

export const challengeInput: ChatwootCommerceChallengeInput = {
  ...state,
  conversationId: 905,
  requestId: 'request_7d3bd0e2',
  visitorTokenSha256,
};

export const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  EKAETTE_CHATWOOT_CONTEXT_ENABLED: 'true',
  EKAETTE_CHATWOOT_CONTEXT_BINDINGS: JSON.stringify([
    {
      inboxId: state.inboxId,
      merchantId,
      origin: state.origin,
      websiteToken: state.websiteToken,
    },
  ]),
  EKAETTE_CHATWOOT_CHALLENGE_ISSUER: 'https://baci.example',
  EKAETTE_CHATWOOT_CHALLENGE_PRIVATE_KEY: '',
  CHATWOOT_EKAETTE_CONTEXT_ISSUER: 'https://chatwoot.example',
  CHATWOOT_EKAETTE_CONTEXT_PUBLIC_KEY: '',
};

export let challengePublicKey: Awaited<
  ReturnType<typeof generateKeyPair>
>['publicKey'];
let chatwootPrivateKey: Awaited<
  ReturnType<typeof generateKeyPair>
>['privateKey'];
let cryptoReady: Promise<void> | undefined;

export function prepareChatwootCommerceContextCrypto(): Promise<void> {
  cryptoReady ??= (async () => {
    const challengePair = await generateKeyPair('RS256', {
      modulusLength: 2048,
    });
    challengePublicKey = challengePair.publicKey;
    const chatwootPair = await generateKeyPair('RS256', {
      modulusLength: 2048,
    });
    chatwootPrivateKey = chatwootPair.privateKey;
    env.EKAETTE_CHATWOOT_CHALLENGE_PRIVATE_KEY = await exportPKCS8(
      challengePair.privateKey
    );
    env.CHATWOOT_EKAETTE_CONTEXT_PUBLIC_KEY = await exportSPKI(
      chatwootPair.publicKey
    );
  })();
  return cryptoReady;
}

export async function makeContextToken(
  challengeToken: string,
  claimsOverride: Record<string, unknown> = {},
  options: { iat?: number; exp?: number } = {}
) {
  await prepareChatwootCommerceContextCrypto();
  const { payload } = await jwtVerify(challengeToken, challengePublicKey, {
    algorithms: ['RS256'],
    audience: `${CHATWOOT_CHALLENGE_SCOPE}:${state.websiteToken}`,
    issuer: 'https://baci.example',
    currentDate: fixedTime,
  });
  const issuedAt = options.iat ?? Math.floor(fixedTime.getTime() / 1000) + 1;
  const expiresAt = options.exp ?? issuedAt + 60;
  return new SignJWT({
    cart_id: payload.cart_id,
    cart_session_sha256: payload.cart_session_sha256,
    cart_version: payload.cart_version,
    conversation_id: payload.conversation_id,
    inbox_id: payload.inbox_id,
    merchant_id: payload.merchant_id,
    origin: payload.origin,
    request_id: payload.request_id,
    visitor_token_sha256: payload.visitor_token_sha256,
    website_token: payload.website_token,
    ...claimsOverride,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer('https://chatwoot.example')
    .setAudience('baci-ekaette-commerce-context')
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt)
    .setExpirationTime(expiresAt)
    .setJti(String(claimsOverride.jti ?? payload.nonce))
    .sign(chatwootPrivateKey);
}

export async function makeChallenge(
  overrides: Partial<ChatwootCommerceChallengeInput> = {}
) {
  await prepareChatwootCommerceContextCrypto();
  return issueChatwootCommerceChallenge(
    { ...challengeInput, ...overrides },
    { env, now: fixedTime }
  );
}
