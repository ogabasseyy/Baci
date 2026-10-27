import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkAnonymousCartQuota,
  getCartQuotaClientIdentity,
} from './quota-identity';
import {
  __resetCartQuotaStoreForTesting,
  CART_QUOTA_BUDGETS,
} from './request-quota';

vi.mock('@/lib/redis', () => ({ getRedis: () => null }));

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCartQuotaStoreForTesting();
});

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL_A = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL_B = '22222222-2222-4222-8222-222222222222';

function requestWith(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost:3000/api/storefront/cart', {
    headers,
  });
}

describe('getCartQuotaClientIdentity', () => {
  it('keys quota identity on the client credential, not the network address', () => {
    vi.stubEnv('VERCEL', '1');
    const sharedEgress = { 'x-real-ip': '172.68.1.20' };
    const first = getCartQuotaClientIdentity(
      requestWith({
        ...sharedEgress,
        'x-baci-client-credential': CREDENTIAL_A,
      })
    );
    const second = getCartQuotaClientIdentity(
      requestWith({
        ...sharedEgress,
        'x-baci-client-credential': CREDENTIAL_B,
      })
    );
    // Two shoppers behind one egress get independent budgets.
    expect(first).not.toBe(second);
    expect(first.startsWith('client-credential:')).toBe(true);
    // The identity is a hash: the raw credential never appears in keys.
    expect(first).not.toContain(CREDENTIAL_A);
  });

  it('is stable for one credential across changing network addresses', () => {
    vi.stubEnv('VERCEL', '1');
    const atHome = getCartQuotaClientIdentity(
      requestWith({
        'x-baci-client-credential': CREDENTIAL_A,
        'x-real-ip': '192.0.2.10',
      })
    );
    const onCarrierNat = getCartQuotaClientIdentity(
      requestWith({
        'x-baci-client-credential': CREDENTIAL_A,
        'x-real-ip': '198.51.100.7',
      })
    );
    expect(onCarrierNat).toBe(atHome);
  });

  it('falls back to the legacy trusted network identity without a credential', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      getCartQuotaClientIdentity(requestWith({ 'x-real-ip': '192.0.2.44' }))
    ).toBe('192.0.2.44');
  });

  it('falls back when the credential is malformed', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      getCartQuotaClientIdentity(
        requestWith({
          'x-baci-client-credential': 'not-a-credential',
          'x-real-ip': '192.0.2.44',
        })
      )
    ).toBe('192.0.2.44');
  });
});

describe('checkAnonymousCartQuota', () => {
  const create = { merchantId: MERCHANT_ID, operation: 'create' } as const;

  it('bounds credential rotation with the non-rotatable network backstop', async () => {
    vi.stubEnv('VERCEL', '1');
    __resetCartQuotaStoreForTesting();
    const backstopLimit = CART_QUOTA_BUDGETS.create_network_backstop.limit;
    // Every call rotates to a fresh credential from one network
    // address: per-credential budgets never trip, so only the
    // network backstop can stop this.
    for (let attempt = 0; attempt < backstopLimit; attempt++) {
      const result = await checkAnonymousCartQuota(
        requestWith({
          'x-baci-client-credential': randomUUID(),
          'x-real-ip': '192.0.2.44',
        }),
        create
      );
      expect(result.allowed).toBe(true);
    }
    const denied = await checkAnonymousCartQuota(
      requestWith({
        'x-baci-client-credential': randomUUID(),
        'x-real-ip': '192.0.2.44',
      }),
      create
    );
    expect(denied.allowed).toBe(false);
  });

  it('keeps per-credential budgets independent below the backstop', async () => {
    vi.stubEnv('VERCEL', '1');
    __resetCartQuotaStoreForTesting();
    const limit = CART_QUOTA_BUDGETS.create.limit;
    for (let attempt = 0; attempt < limit; attempt++) {
      const result = await checkAnonymousCartQuota(
        requestWith({
          'x-baci-client-credential': CREDENTIAL_A,
          'x-real-ip': '192.0.2.44',
        }),
        create
      );
      expect(result.allowed).toBe(true);
    }
    const exhausted = await checkAnonymousCartQuota(
      requestWith({
        'x-baci-client-credential': CREDENTIAL_A,
        'x-real-ip': '192.0.2.44',
      }),
      create
    );
    expect(exhausted.allowed).toBe(false);
    const otherShopper = await checkAnonymousCartQuota(
      requestWith({
        'x-baci-client-credential': CREDENTIAL_B,
        'x-real-ip': '192.0.2.44',
      }),
      create
    );
    expect(otherShopper.allowed).toBe(true);
  });

  it('is a single legacy network check without a credential', async () => {
    vi.stubEnv('VERCEL', '1');
    __resetCartQuotaStoreForTesting();
    const limit = CART_QUOTA_BUDGETS.create.limit;
    for (let attempt = 0; attempt < limit; attempt++) {
      const result = await checkAnonymousCartQuota(
        requestWith({ 'x-real-ip': '192.0.2.44' }),
        create
      );
      expect(result.allowed).toBe(true);
    }
    const denied = await checkAnonymousCartQuota(
      requestWith({ 'x-real-ip': '192.0.2.44' }),
      create
    );
    expect(denied.allowed).toBe(false);
  });
});
