// @vitest-environment node

import { jwtVerify } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CHATWOOT_CHALLENGE_SCOPE,
  getChatwootTenantBinding,
  issueChatwootCommerceChallenge,
} from './commerce-context';
import {
  challengeInput,
  challengePublicKey,
  env,
  fixedTime,
  makeChallenge,
  prepareChatwootCommerceContextCrypto,
  state,
} from './commerce-context.test-fixtures';

beforeAll(prepareChatwootCommerceContextCrypto);

describe('Chatwoot challenge configuration and issuance', () => {
  it('keeps the feature off by default and rejects duplicate tenant bindings', () => {
    expect(() =>
      getChatwootTenantBinding(state.merchantId, { NODE_ENV: 'test' })
    ).toThrowError(expect.objectContaining({ code: 'disabled' }));
    expect(() =>
      getChatwootTenantBinding(state.merchantId, {
        ...env,
        EKAETTE_CHATWOOT_CONTEXT_BINDINGS: JSON.stringify([
          ...JSON.parse(env.EKAETTE_CHATWOOT_CONTEXT_BINDINGS ?? '[]'),
          ...JSON.parse(env.EKAETTE_CHATWOOT_CONTEXT_BINDINGS ?? '[]'),
        ]),
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid_config' }));
  });

  it('rejects non-numeric inbox identifiers and shared widget credentials', () => {
    const [binding] = JSON.parse(
      env.EKAETTE_CHATWOOT_CONTEXT_BINDINGS ?? '[]'
    ) as Record<string, unknown>[];
    const otherMerchantId = '6df442af-4d21-4f4f-9f0b-607400000099';

    expect(() =>
      getChatwootTenantBinding(state.merchantId, {
        ...env,
        EKAETTE_CHATWOOT_CONTEXT_BINDINGS: JSON.stringify([
          { ...binding, inboxId: '74' },
        ]),
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid_config' }));

    for (const duplicate of [
      { ...binding, merchantId: otherMerchantId, inboxId: 75 },
      {
        ...binding,
        merchantId: otherMerchantId,
        websiteToken: 'other-widget-token-123456',
      },
    ]) {
      expect(() =>
        getChatwootTenantBinding(state.merchantId, {
          ...env,
          EKAETTE_CHATWOOT_CONTEXT_BINDINGS: JSON.stringify([
            binding,
            duplicate,
          ]),
        })
      ).toThrowError(expect.objectContaining({ code: 'invalid_config' }));
    }
  });

  it('allows same-origin slug stores with distinct widget and inbox bindings', () => {
    const [binding] = JSON.parse(
      env.EKAETTE_CHATWOOT_CONTEXT_BINDINGS ?? '[]'
    ) as Record<string, unknown>[];
    expect(() =>
      getChatwootTenantBinding(state.merchantId, {
        ...env,
        EKAETTE_CHATWOOT_CONTEXT_BINDINGS: JSON.stringify([
          binding,
          {
            ...binding,
            merchantId: '6df442af-4d21-4f4f-9f0b-607400000099',
            websiteToken: 'other-widget-token-123456',
            inboxId: state.inboxId + 1,
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
      cart_id: state.cartId,
      cart_session_sha256: state.cartSessionSha256,
      cart_version: 12,
      conversation_id: 905,
      inbox_id: 74,
      merchant_id: state.merchantId,
      origin: state.origin,
      request_id: challengeInput.requestId,
      scope: CHATWOOT_CHALLENGE_SCOPE,
      visitor_token_sha256: challengeInput.visitorTokenSha256,
      website_token: state.websiteToken,
    });
    expect(String(payload.nonce)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Number(payload.exp) - Number(payload.iat)).toBe(90);
    expect(payload).not.toHaveProperty('cart_session_proof');
  });

  it('accepts the bounded principal format used by linked customer carts', async () => {
    const linkedPrincipal =
      'customer-device:6df442af-4d21-4f4f-9f0b-607400000099';
    const token = await makeChallenge({ principalId: linkedPrincipal });
    const { payload } = await jwtVerify(token, challengePublicKey, {
      algorithms: ['RS256'],
      audience: `${CHATWOOT_CHALLENGE_SCOPE}:${state.websiteToken}`,
      issuer: 'https://baci.example',
      currentDate: fixedTime,
    });

    expect(payload.principal_id).toBe(linkedPrincipal);
    await expect(
      makeChallenge({ principalId: 'x'.repeat(129) })
    ).rejects.toMatchObject({
      code: 'invalid_challenge',
    });
  });

  it('refuses request-selected widget credentials and cross-tenant substitution', async () => {
    await expect(
      makeChallenge({ websiteToken: 'attacker-selected-widget-token' })
    ).rejects.toMatchObject({ code: 'binding_unavailable' });
    await expect(makeChallenge({ inboxId: 75 })).rejects.toMatchObject({
      code: 'binding_unavailable',
    });
    await expect(
      makeChallenge({
        merchantId: '6df442af-4d21-4f4f-9f0b-607400000099',
      })
    ).rejects.toMatchObject({ code: 'binding_unavailable' });
  });

  it('rejects malformed challenge claims before signing', async () => {
    await expect(
      issueChatwootCommerceChallenge(
        { ...challengeInput, requestId: 'short' },
        { env, now: fixedTime }
      )
    ).rejects.toMatchObject({ code: 'invalid_challenge' });
  });
});
