// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  getChatwootTenantBinding,
  verifyChatwootCommerceContext,
  verifyChatwootSessionCapability,
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

describe('Chatwoot session capability', () => {
  it('is short-lived and scoped to the same live cart session', async () => {
    const challengeToken = await makeChallenge();
    const contextToken = await makeContextToken(challengeToken);
    const binding = getChatwootTenantBinding(merchantId, env);
    const verified = await verifyChatwootCommerceContext({
      challengeToken,
      contextToken,
      state,
      binding,
      env,
      now: new Date(fixedTime.getTime() + 2_000),
      consume: vi.fn(async () => undefined),
    });
    const options = {
      sessionToken: verified.sessionToken,
      state,
      binding,
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

  it('allows monotonic cart advances through add, quantity and review only', async () => {
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
