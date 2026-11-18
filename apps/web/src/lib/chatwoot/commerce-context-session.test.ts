// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  getChatwootTenantBinding,
  hashCartSessionProof,
  rebindChatwootSessionCapability,
  renewChatwootSessionCapability,
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
      visitorTokenSha256: 'b'.repeat(64),
    });
    await expect(
      verifyChatwootSessionCapability({
        ...options,
        state: { ...state, cartVersion: 13 },
      })
    ).resolves.toEqual({
      conversationId: 905,
      sessionExpiresAt: verified.sessionExpiresAt,
      visitorTokenSha256: 'b'.repeat(64),
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

  it('rebinds only the same conversation and cart session after proof renewal', async () => {
    const challengeToken = await makeChallenge();
    const original = await verifyChatwootCommerceContext({
      challengeToken,
      contextToken: await makeContextToken(challengeToken),
      state,
      binding: getChatwootTenantBinding(merchantId, env),
      env,
      now: new Date(fixedTime.getTime() + 2_000),
      consume: vi.fn(async () => undefined),
    });
    const binding = getChatwootTenantBinding(merchantId, env);
    const nextState = {
      ...state,
      cartSessionSha256: hashCartSessionProof('renewed-proof'),
      cartVersion: state.cartVersion + 1,
    };
    const renewedToken = await renewChatwootSessionCapability({
      sessionToken: original.sessionToken,
      previousState: state,
      nextState,
      binding,
      env,
      now: new Date(fixedTime.getTime() + 3_000),
    });

    await expect(
      verifyChatwootSessionCapability({
        sessionToken: renewedToken,
        state: nextState,
        binding,
        env,
        now: new Date(fixedTime.getTime() + 4_000),
      })
    ).resolves.toMatchObject({
      conversationId: 905,
      sessionExpiresAt: original.sessionExpiresAt,
      visitorTokenSha256: 'b'.repeat(64),
    });
    await expect(
      verifyChatwootSessionCapability({
        sessionToken: original.sessionToken,
        state: nextState,
        binding,
        env,
        now: new Date(fixedTime.getTime() + 4_000),
      })
    ).rejects.toMatchObject({ code: 'invalid_context' });
    await expect(
      renewChatwootSessionCapability({
        sessionToken: original.sessionToken,
        previousState: state,
        nextState: { ...nextState, principalId: 'other-principal' },
        binding,
        env,
        now: new Date(fixedTime.getTime() + 3_000),
      })
    ).rejects.toMatchObject({ code: 'invalid_context' });

    const recovered = await rebindChatwootSessionCapability({
      sessionToken: original.sessionToken,
      state: nextState,
      binding,
      env,
      now: new Date(fixedTime.getTime() + 4_000),
    });
    expect(recovered.sessionExpiresAt).toBe(original.sessionExpiresAt);
    await expect(
      verifyChatwootSessionCapability({
        sessionToken: recovered.sessionToken,
        state: nextState,
        binding,
        env,
        now: new Date(fixedTime.getTime() + 5_000),
      })
    ).resolves.toMatchObject({ conversationId: 905 });
    for (const invalidState of [
      { ...nextState, merchantId: 'other-merchant' },
      { ...nextState, origin: 'https://other.example' },
      { ...nextState, cartId: 'other-cart' },
      { ...nextState, grantId: 'other-grant' },
      { ...nextState, principalId: 'other-principal' },
      { ...nextState, cartVersion: state.cartVersion - 1 },
    ]) {
      await expect(
        rebindChatwootSessionCapability({
          sessionToken: original.sessionToken,
          state: invalidState,
          binding,
          env,
          now: new Date(fixedTime.getTime() + 4_000),
        })
      ).rejects.toMatchObject({ code: 'invalid_context' });
    }
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
