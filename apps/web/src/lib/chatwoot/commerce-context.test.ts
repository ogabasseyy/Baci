// @vitest-environment node
// Jose's RSA signer requires same-realm Uint8Array payloads; production
// routes run in Node, so this suite exercises that runtime directly.
import {
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CHATWOOT_CHALLENGE_SCOPE,
  type ChatwootCommerceChallengeInput,
  ChatwootCommerceContextError,
  type ChatwootCommerceContextState,
  getChatwootTenantBinding,
  hashCartSessionProof,
  issueChatwootCommerceChallenge,
  verifyChatwootCommerceContext,
  verifyChatwootSessionCapability,
} from './commerce-context';

const merchantId = '6df442af-4d21-4f4f-9f0b-607400000001';
const cartId = '6df442af-4d21-4f4f-9f0b-607400000002';
const grantId = '6df442af-4d21-4f4f-9f0b-607400000003';
const principalId = '6df442af-4d21-4f4f-9f0b-607400000004';
const visitorTokenSha256 = 'b'.repeat(64);
const cartSessionSha256 = hashCartSessionProof('synthetic-cart-session-proof');
const fixedTime = new Date('2026-11-07T12:00:00.000Z');

const state: ChatwootCommerceContextState = {
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

const input: ChatwootCommerceChallengeInput = {
  ...state,
  conversationId: 905,
  requestId: 'request_7d3bd0e2',
  visitorTokenSha256,
};

const env: NodeJS.ProcessEnv = {
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

let challengePublicKey: Awaited<
  ReturnType<typeof generateKeyPair>
>['publicKey'];
let chatwootPrivateKey: Awaited<
  ReturnType<typeof generateKeyPair>
>['privateKey'];

beforeAll(async () => {
  const challengePair = await generateKeyPair('RS256', { modulusLength: 2048 });
  challengePublicKey = challengePair.publicKey;
  const chatwootPair = await generateKeyPair('RS256', { modulusLength: 2048 });
  chatwootPrivateKey = chatwootPair.privateKey;
  env.EKAETTE_CHATWOOT_CHALLENGE_PRIVATE_KEY = await exportPKCS8(
    challengePair.privateKey
  );
  env.CHATWOOT_EKAETTE_CONTEXT_PUBLIC_KEY = await exportSPKI(
    chatwootPair.publicKey
  );
});

async function makeContextToken(
  challengeToken: string,
  claimsOverride: Record<string, unknown> = {},
  options: { iat?: number; exp?: number } = {}
) {
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

async function makeChallenge(
  overrides: Partial<ChatwootCommerceChallengeInput> = {}
) {
  return issueChatwootCommerceChallenge(
    { ...input, ...overrides },
    { env, now: fixedTime }
  );
}

describe('Chatwoot commerce context trust boundary', () => {
  it('keeps the feature off by default and rejects duplicate tenant bindings', () => {
    expect(() =>
      getChatwootTenantBinding(merchantId, { NODE_ENV: 'test' })
    ).toThrowError(expect.objectContaining({ code: 'disabled' }));
    expect(() =>
      getChatwootTenantBinding(merchantId, {
        ...env,
        EKAETTE_CHATWOOT_CONTEXT_BINDINGS: JSON.stringify([
          ...JSON.parse(env.EKAETTE_CHATWOOT_CONTEXT_BINDINGS ?? '[]'),
          ...JSON.parse(env.EKAETTE_CHATWOOT_CONTEXT_BINDINGS ?? '[]'),
        ]),
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid_config' }));
  });

  it('rejects non-numeric inbox identifiers in tenant binding configuration', () => {
    const [binding] = JSON.parse(
      env.EKAETTE_CHATWOOT_CONTEXT_BINDINGS ?? '[]'
    ) as Record<string, unknown>[];
    expect(() =>
      getChatwootTenantBinding(merchantId, {
        ...env,
        EKAETTE_CHATWOOT_CONTEXT_BINDINGS: JSON.stringify([
          { ...binding, inboxId: '74' },
        ]),
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid_config' }));
  });

  it('fails closed when a Chatwoot website token or inbox is shared across tenants', () => {
    const binding = JSON.parse(
      env.EKAETTE_CHATWOOT_CONTEXT_BINDINGS ?? '[]'
    )[0] as {
      inboxId: number;
      merchantId: string;
      origin: string;
      websiteToken: string;
    };
    const otherMerchantId = '6df442af-4d21-4f4f-9f0b-607400000099';
    const conflictingBindings = [
      {
        ...binding,
        merchantId: otherMerchantId,
        inboxId: binding.inboxId + 1,
      },
      {
        ...binding,
        merchantId: otherMerchantId,
        websiteToken: 'other-widget-token-123456',
      },
    ];

    for (const duplicate of conflictingBindings) {
      expect(() =>
        getChatwootTenantBinding(merchantId, {
          ...env,
          EKAETTE_CHATWOOT_CONTEXT_BINDINGS: JSON.stringify([
            binding,
            duplicate,
          ]),
        })
      ).toThrowError(expect.objectContaining({ code: 'invalid_config' }));
    }

    expect(() =>
      getChatwootTenantBinding(merchantId, {
        ...env,
        EKAETTE_CHATWOOT_CONTEXT_BINDINGS: JSON.stringify([
          binding,
          {
            ...binding,
            merchantId: otherMerchantId,
            websiteToken: 'other-widget-token-123456',
            inboxId: binding.inboxId + 1,
          },
        ]),
      })
    ).not.toThrow();
  });

  it('issues a short-lived signed challenge with a server-generated nonce and exact bindings', async () => {
    const token = await makeChallenge();
    const { payload, protectedHeader } = await jwtVerify(
      token,
      challengePublicKey,
      {
        algorithms: ['RS256'],
        audience: `${CHATWOOT_CHALLENGE_SCOPE}:${state.websiteToken}`,
        issuer: 'https://baci.example',
        currentDate: fixedTime,
      }
    );

    expect(protectedHeader.alg).toBe('RS256');
    expect(payload).toMatchObject({
      cart_id: cartId,
      cart_session_sha256: cartSessionSha256,
      cart_version: 12,
      conversation_id: 905,
      inbox_id: 74,
      merchant_id: merchantId,
      origin: 'https://shop.example.com',
      request_id: 'request_7d3bd0e2',
      scope: CHATWOOT_CHALLENGE_SCOPE,
      visitor_token_sha256: visitorTokenSha256,
      website_token: state.websiteToken,
    });
    expect(String(payload.nonce)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Number(payload.exp) - Number(payload.iat)).toBe(90);
    expect(payload).not.toHaveProperty('cart_session_proof');
  });

  it('refuses request-selected widget credentials and cross-tenant substitution', async () => {
    await expect(
      makeChallenge({ websiteToken: 'attacker-selected-widget-token' })
    ).rejects.toMatchObject({
      code: 'binding_unavailable',
    });
    await expect(makeChallenge({ inboxId: 75 })).rejects.toMatchObject({
      code: 'binding_unavailable',
    });
    await expect(
      makeChallenge({ merchantId: '6df442af-4d21-4f4f-9f0b-607400000099' })
    ).rejects.toMatchObject({
      code: 'binding_unavailable',
    });
  });

  it('verifies only the exact current cart session, tenant, origin, inbox and conversation', async () => {
    const challengeToken = await makeChallenge();
    const contextToken = await makeContextToken(challengeToken);
    const consume = vi.fn(async () => undefined);

    await expect(
      verifyChatwootCommerceContext({
        challengeToken,
        contextToken,
        state,
        binding: getChatwootTenantBinding(merchantId, env),
        env,
        now: new Date(fixedTime.getTime() + 2_000),
        consume,
      })
    ).resolves.toMatchObject({
      conversationId: 905,
      requestId: 'request_7d3bd0e2',
      sessionExpiresAt: Math.floor(fixedTime.getTime() / 1000) + 2 + 600,
      sessionToken: expect.any(String),
    });
    expect(consume).toHaveBeenCalledOnce();

    const mismatches: Partial<ChatwootCommerceContextState>[] = [
      { merchantId: '6df442af-4d21-4f4f-9f0b-607400000099' },
      { origin: 'https://other.example.com' },
      { cartId: '6df442af-4d21-4f4f-9f0b-607400000099' },
      { cartVersion: 13 },
      { cartSessionSha256: 'c'.repeat(64) },
      { principalId: '6df442af-4d21-4f4f-9f0b-607400000099' },
      { grantId: '6df442af-4d21-4f4f-9f0b-607400000099' },
    ];
    for (const mismatch of mismatches) {
      await expect(
        verifyChatwootCommerceContext({
          challengeToken,
          contextToken,
          state: { ...state, ...mismatch },
          binding: getChatwootTenantBinding(merchantId, env),
          env,
          now: new Date(fixedTime.getTime() + 2_000),
          consume: vi.fn(async () => undefined),
        })
      ).rejects.toBeInstanceOf(ChatwootCommerceContextError);
    }
  });

  it('rejects context token substitution, expiry and changed conversation binding', async () => {
    const challengeToken = await makeChallenge();
    const binding = getChatwootTenantBinding(merchantId, env);

    await expect(
      verifyChatwootCommerceContext({
        challengeToken,
        contextToken: await makeContextToken(challengeToken, {
          conversation_id: 906,
        }),
        state,
        binding,
        env,
        now: new Date(fixedTime.getTime() + 2_000),
        consume: vi.fn(async () => undefined),
      })
    ).rejects.toMatchObject({ code: 'invalid_context' });

    await expect(
      verifyChatwootCommerceContext({
        challengeToken,
        contextToken: await makeContextToken(challengeToken),
        state,
        binding,
        env,
        now: new Date(fixedTime.getTime() + 70_000),
        consume: vi.fn(async () => undefined),
      })
    ).rejects.toMatchObject({ code: 'invalid_context' });

    await expect(
      verifyChatwootCommerceContext({
        challengeToken,
        contextToken: await makeContextToken(challengeToken),
        state,
        binding,
        env,
        now: new Date(fixedTime.getTime() + 2_000),
        consume: vi.fn(async () => undefined),
      })
    ).resolves.toBeDefined();
  });

  it('rejects a reused context nonce through an atomic one-time replay store', async () => {
    const challengeToken = await makeChallenge();
    const contextToken = await makeContextToken(challengeToken);
    const used = new Set<string>();
    const consume = vi.fn(async (tenant: string, nonce: string) => {
      const key = `${tenant}:${nonce}`;
      if (used.has(key)) {
        throw new ChatwootCommerceContextError('replayed_context');
      }
      used.add(key);
    });
    const options = {
      challengeToken,
      contextToken,
      state,
      binding: getChatwootTenantBinding(merchantId, env),
      env,
      now: new Date(fixedTime.getTime() + 2_000),
      consume,
    };

    await verifyChatwootCommerceContext(options);
    await expect(verifyChatwootCommerceContext(options)).rejects.toMatchObject({
      code: 'replayed_context',
    });
    expect(consume).toHaveBeenCalledTimes(2);
  });

  it('issues a reusable short-lived capability scoped to the same live cart session', async () => {
    const challengeToken = await makeChallenge();
    const contextToken = await makeContextToken(challengeToken);
    const verified = await verifyChatwootCommerceContext({
      challengeToken,
      contextToken,
      state,
      binding: getChatwootTenantBinding(merchantId, env),
      env,
      now: new Date(fixedTime.getTime() + 2_000),
      consume: vi.fn(async () => undefined),
    });
    const options = {
      sessionToken: verified.sessionToken,
      state,
      binding: getChatwootTenantBinding(merchantId, env),
      env,
      now: new Date(fixedTime.getTime() + 3_000),
    };

    await expect(verifyChatwootSessionCapability(options)).resolves.toEqual({
      conversationId: 905,
      sessionExpiresAt: verified.sessionExpiresAt,
    });
    await expect(
      verifyChatwootSessionCapability({
        ...options,
        state: { ...state, cartVersion: 13 },
      })
    ).resolves.toEqual({
      conversationId: 905,
      sessionExpiresAt: verified.sessionExpiresAt,
    });
    await expect(
      verifyChatwootSessionCapability({
        ...options,
        state: { ...state, cartSessionSha256: 'c'.repeat(64) },
      })
    ).rejects.toMatchObject({ code: 'invalid_context' });
    await expect(
      verifyChatwootSessionCapability({
        ...options,
        state: { ...state, cartVersion: 11 },
      })
    ).rejects.toMatchObject({ code: 'invalid_context' });
    await expect(
      verifyChatwootSessionCapability({
        ...options,
        now: new Date(verified.sessionExpiresAt * 1000),
      })
    ).rejects.toMatchObject({ code: 'invalid_context' });
  });

  it('keeps a capability usable across add, quantity and review version advances, but rejects a stale cart version', async () => {
    const challengeToken = await makeChallenge();
    const verified = await verifyChatwootCommerceContext({
      challengeToken,
      contextToken: await makeContextToken(challengeToken),
      state,
      binding: getChatwootTenantBinding(merchantId, env),
      env,
      now: new Date(fixedTime.getTime() + 2_000),
      consume: vi.fn(async () => undefined),
    });
    for (const cartVersion of [13, 14, 14]) {
      await expect(
        verifyChatwootSessionCapability({
          sessionToken: verified.sessionToken,
          state: { ...state, cartVersion },
          binding: getChatwootTenantBinding(merchantId, env),
          env,
          now: new Date(fixedTime.getTime() + 3_000),
        })
      ).resolves.toMatchObject({ conversationId: 905 });
    }
    await expect(
      verifyChatwootSessionCapability({
        sessionToken: verified.sessionToken,
        state: { ...state, cartVersion: 11 },
        binding: getChatwootTenantBinding(merchantId, env),
        env,
        now: new Date(fixedTime.getTime() + 3_000),
      })
    ).rejects.toMatchObject({ code: 'invalid_context' });
  });
});
