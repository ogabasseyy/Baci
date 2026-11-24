// @vitest-environment node

import { exportSPKI, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  getChatwootTenantBinding,
  verifyChatwootCommerceContext,
  verifyChatwootSessionCapability,
} from './commerce-context';
import {
  challengePublicKey,
  env,
  fixedTime,
  makeChallenge,
  makeContextToken,
  merchantId,
  prepareChatwootCommerceContextCrypto,
  state,
} from './commerce-context.test-fixtures';

beforeAll(prepareChatwootCommerceContextCrypto);

const PUBLIC_KEY_VAR = 'EKAETTE_CHATWOOT_CHALLENGE_PUBLIC_KEY';
const PRIVATE_KEY_VAR = 'EKAETTE_CHATWOOT_CHALLENGE_PRIVATE_KEY';

async function issueSessionToken() {
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
  return verified;
}

describe('bugfix: reading a chat session needed the private signing key', () => {
  it('verifies a privately signed session token with only the public key configured', async () => {
    const verified = await issueSessionToken();
    const { [PRIVATE_KEY_VAR]: _privateKey, ...withoutPrivate } = env;
    const publicOnlyEnv: NodeJS.ProcessEnv = {
      ...withoutPrivate,
      [PUBLIC_KEY_VAR]: await exportSPKI(challengePublicKey),
    };

    expect(publicOnlyEnv[PRIVATE_KEY_VAR]).toBeUndefined();
    await expect(
      verifyChatwootSessionCapability({
        sessionToken: verified.sessionToken,
        state,
        binding: getChatwootTenantBinding(merchantId, publicOnlyEnv),
        env: publicOnlyEnv,
        now: new Date(fixedTime.getTime() + 3_000),
      })
    ).resolves.toEqual({
      conversationId: 905,
      sessionExpiresAt: verified.sessionExpiresAt,
      visitorTokenSha256: 'b'.repeat(64),
    });
  });

  it('keeps verifying through the private key when no public key is configured', async () => {
    const verified = await issueSessionToken();

    await expect(
      verifyChatwootSessionCapability({
        sessionToken: verified.sessionToken,
        state,
        binding: getChatwootTenantBinding(merchantId, env),
        env,
        now: new Date(fixedTime.getTime() + 3_000),
      })
    ).resolves.toMatchObject({ conversationId: 905 });
  });

  it('rejects the token when the configured public key belongs to a different pair', async () => {
    const verified = await issueSessionToken();
    const other = await generateKeyPair('RS256', { modulusLength: 2048 });
    const mismatchedEnv: NodeJS.ProcessEnv = {
      ...env,
      [PUBLIC_KEY_VAR]: await exportSPKI(other.publicKey),
    };

    await expect(
      verifyChatwootSessionCapability({
        sessionToken: verified.sessionToken,
        state,
        binding: getChatwootTenantBinding(merchantId, mismatchedEnv),
        env: mismatchedEnv,
        now: new Date(fixedTime.getTime() + 3_000),
      })
    ).rejects.toMatchObject({ code: 'invalid_context' });
  });

  it('fails closed with invalid_config when the configured public key is malformed', async () => {
    const verified = await issueSessionToken();
    const brokenEnv: NodeJS.ProcessEnv = {
      ...env,
      [PUBLIC_KEY_VAR]:
        '-----BEGIN PUBLIC KEY-----\nbm90IGEga2V5\n-----END PUBLIC KEY-----',
    };

    await expect(
      verifyChatwootSessionCapability({
        sessionToken: verified.sessionToken,
        state,
        binding: getChatwootTenantBinding(merchantId, brokenEnv),
        env: brokenEnv,
        now: new Date(fixedTime.getTime() + 3_000),
      })
    ).rejects.toMatchObject({ code: 'invalid_config' });
  });
});
