import { generateKeyPairSync } from 'node:crypto';
import { decodeJwt, SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createChatCustomerLinkVerifier,
  issueChatCustomerLinkToken,
} from './chat-customer-link-token';

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const OTHER_MERCHANT = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';

function env(): NodeJS.ProcessEnv {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    NODE_ENV: 'test',
    EKAETTE_CHATWOOT_CHALLENGE_PRIVATE_KEY: privateKey
      .export({ format: 'pem', type: 'pkcs8' })
      .toString(),
    EKAETTE_CHATWOOT_CHALLENGE_ISSUER: 'https://app.example.test',
  };
}

describe('chat customer link token lifetime', () => {
  it('bugfix: expires after 30 days, not 90, so a copied note stops working sooner', async () => {
    const token = await issueChatCustomerLinkToken(
      { merchantId: MERCHANT, customerId: CUSTOMER },
      { env: env(), now: new Date('2026-01-01T00:00:00Z') }
    );
    const claims = decodeJwt(token as string);
    expect((claims.exp as number) - (claims.iat as number)).toBe(
      30 * 24 * 60 * 60
    );
  });

  it('verifies on day 29 and refuses on day 31', async () => {
    const e = env();
    const issuedAt = new Date('2026-01-01T00:00:00Z');
    const token = await issueChatCustomerLinkToken(
      { merchantId: MERCHANT, customerId: CUSTOMER },
      { env: e, now: issuedAt }
    );
    const at = (days: number) =>
      new Date(issuedAt.getTime() + days * 86_400_000);
    const day29 = await createChatCustomerLinkVerifier(MERCHANT, {
      env: e,
      now: at(29),
    });
    const day31 = await createChatCustomerLinkVerifier(MERCHANT, {
      env: e,
      now: at(31),
    });
    await expect(day29?.(token)).resolves.not.toBeNull();
    await expect(day31?.(token)).resolves.toBeNull();
  });
});

describe('chat customer link token', () => {
  it('verifies a token it issued for the same store', async () => {
    const e = env();
    const token = await issueChatCustomerLinkToken(
      { merchantId: MERCHANT, customerId: CUSTOMER },
      { env: e }
    );
    const verify = await createChatCustomerLinkVerifier(MERCHANT, { env: e });

    expect(token).toBeTruthy();
    await expect(verify?.(token)).resolves.toEqual({
      merchantId: MERCHANT,
      customerId: CUSTOMER,
    });
  });

  it('rejects a token made for another store', async () => {
    const e = env();
    const token = await issueChatCustomerLinkToken(
      { merchantId: OTHER_MERCHANT, customerId: CUSTOMER },
      { env: e }
    );
    const verify = await createChatCustomerLinkVerifier(MERCHANT, { env: e });
    await expect(verify?.(token)).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const e = env();
    const token = await issueChatCustomerLinkToken(
      { merchantId: MERCHANT, customerId: CUSTOMER },
      { env: e, now: new Date('2026-01-01T00:00:00Z') }
    );
    const verify = await createChatCustomerLinkVerifier(MERCHANT, {
      env: e,
      now: new Date('2026-06-01T00:00:00Z'),
    });
    await expect(verify?.(token)).resolves.toBeNull();
  });

  it('rejects a token signed by a different key', async () => {
    const forger = env();
    const token = await issueChatCustomerLinkToken(
      { merchantId: MERCHANT, customerId: CUSTOMER },
      { env: forger }
    );
    const verify = await createChatCustomerLinkVerifier(MERCHANT, {
      env: env(),
    });
    await expect(verify?.(token)).resolves.toBeNull();
  });

  it('rejects a token of the same key issued for another purpose', async () => {
    const e = env();
    const { importPKCS8 } = await import('jose');
    const key = await importPKCS8(
      (e.EKAETTE_CHATWOOT_CHALLENGE_PRIVATE_KEY as string).replace(
        /\\n/g,
        '\n'
      ),
      'RS256'
    );
    const other = await new SignJWT({
      scope: 'chatwoot-ekaette-commerce-context',
      merchant_id: MERCHANT,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://app.example.test')
      .setAudience('baci-ekaette-commerce-context')
      .setSubject(CUSTOMER)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    const verify = await createChatCustomerLinkVerifier(MERCHANT, { env: e });
    await expect(verify?.(other)).resolves.toBeNull();
  });

  it('rejects junk and non-string values without throwing', async () => {
    const e = env();
    const verify = await createChatCustomerLinkVerifier(MERCHANT, { env: e });
    for (const junk of [
      undefined,
      null,
      42,
      '',
      'a.b.c',
      {},
      'x'.repeat(20000),
    ]) {
      await expect(verify?.(junk)).resolves.toBeNull();
    }
  });

  it('stays off when signing is not configured', async () => {
    await expect(
      issueChatCustomerLinkToken(
        { merchantId: MERCHANT, customerId: CUSTOMER },
        { env: {} as NodeJS.ProcessEnv }
      )
    ).resolves.toBeNull();
    await expect(
      createChatCustomerLinkVerifier(MERCHANT, { env: {} as NodeJS.ProcessEnv })
    ).resolves.toBeNull();
  });

  it('refuses to issue for a malformed id', async () => {
    await expect(
      issueChatCustomerLinkToken(
        { merchantId: 'nope', customerId: CUSTOMER },
        { env: env() }
      )
    ).resolves.toBeNull();
  });
});
