// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ChatwootCommerceContextError,
  getChatwootTenantBinding,
  verifyChatwootCommerceContext,
} from './commerce-context';
import {
  env,
  fixedTime,
  makeChallenge,
  makeContextToken,
  merchantId,
  prepareChatwootCommerceContextCrypto,
  state,
} from './commerce-context.test-fixtures';

beforeAll(prepareChatwootCommerceContextCrypto);

describe('Chatwoot signed context verification and replay', () => {
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

    const mismatches = [
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

  it('rejects substituted, expired, and conversation-mismatched contexts', async () => {
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
  });

  it('retains nonce consumption through challenge expiry when a context expires sooner', async () => {
    const challengeToken = await makeChallenge();
    const challengeIat = Math.floor(fixedTime.getTime() / 1000);
    const challengeExp = challengeIat + 90;
    const earlyContext = await makeContextToken(
      challengeToken,
      {},
      {
        iat: challengeIat + 1,
        exp: challengeIat + 60,
      }
    );
    const usedUntil = new Map<string, number>();
    let nowSeconds = challengeIat + 2;
    const consume = vi.fn(
      async (tenant: string, nonce: string, ttl: number) => {
        const key = `${tenant}:${nonce}`;
        if ((usedUntil.get(key) ?? 0) > nowSeconds) {
          throw new ChatwootCommerceContextError('replayed_context');
        }
        usedUntil.set(key, nowSeconds + ttl);
      }
    );
    const binding = getChatwootTenantBinding(merchantId, env);

    await verifyChatwootCommerceContext({
      challengeToken,
      contextToken: earlyContext,
      state,
      binding,
      env,
      now: new Date(nowSeconds * 1000),
      consume,
    });
    expect([...usedUntil.values()]).toEqual([challengeExp]);

    nowSeconds = challengeIat + 62;
    const lateContext = await makeContextToken(
      challengeToken,
      {},
      {
        iat: challengeIat + 61,
        exp: challengeExp - 1,
      }
    );
    await expect(
      verifyChatwootCommerceContext({
        challengeToken,
        contextToken: lateContext,
        state,
        binding,
        env,
        now: new Date(nowSeconds * 1000),
        consume,
      })
    ).rejects.toMatchObject({ code: 'replayed_context' });
  });
});
