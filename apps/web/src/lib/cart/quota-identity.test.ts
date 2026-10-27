import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkAnonymousCartQuota,
  getCartQuotaClientIdentity,
} from './quota-identity';
import {
  __resetCartQuotaStoreForTesting,
  CART_QUOTA_BUDGETS,
  DEGRADED_BOOTSTRAP_LIMIT,
} from './request-quota';
import { bootstrapMemoryCounters } from './request-quota-counter';

const mockGetRedis = vi.hoisted(() => vi.fn(() => null as unknown));

vi.mock('@/lib/redis', () => ({ getRedis: mockGetRedis }));

/** Healthy shared store: per-key counting fake Redis. */
function useHealthyRedis(): void {
  const counts = new Map<string, number>();
  mockGetRedis.mockReturnValue({
    createScript: () => ({
      eval: async (keys: string[]) => {
        const key = keys[0] ?? '';
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return [next, 3_600_000];
      },
    }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  mockGetRedis.mockReturnValue(null);
  __resetCartQuotaStoreForTesting();
});

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_MERCHANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CREDENTIAL_A = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL_B = '22222222-2222-4222-8222-222222222222';

/** Deterministic distinct valid v4 credentials for rotation tests. */
function rotatedCredential(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

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
      }),
      MERCHANT_ID
    );
    const second = getCartQuotaClientIdentity(
      requestWith({
        ...sharedEgress,
        'x-baci-client-credential': CREDENTIAL_B,
      }),
      MERCHANT_ID
    );
    // Two shoppers behind one egress get independent budgets.
    expect(first).not.toBe(second);
    expect(first.startsWith('client-credential:')).toBe(true);
    // The identity is a hash: the raw credential never appears in keys.
    expect(first).not.toContain(CREDENTIAL_A);
  });

  it('derives unlinkable identities for one credential across merchants', () => {
    vi.stubEnv('VERCEL', '1');
    const headers = { 'x-baci-client-credential': CREDENTIAL_A };
    const atFirst = getCartQuotaClientIdentity(
      requestWith(headers),
      MERCHANT_ID
    );
    const atOther = getCartQuotaClientIdentity(
      requestWith(headers),
      OTHER_MERCHANT_ID
    );
    expect(atOther).not.toBe(atFirst);
  });

  it('is stable for one credential across changing network addresses', () => {
    vi.stubEnv('VERCEL', '1');
    const atHome = getCartQuotaClientIdentity(
      requestWith({
        'x-baci-client-credential': CREDENTIAL_A,
        'x-real-ip': '192.0.2.10',
      }),
      MERCHANT_ID
    );
    const onCarrierNat = getCartQuotaClientIdentity(
      requestWith({
        'x-baci-client-credential': CREDENTIAL_A,
        'x-real-ip': '198.51.100.7',
      }),
      MERCHANT_ID
    );
    expect(onCarrierNat).toBe(atHome);
  });

  it('treats UUID case variants as one identity', () => {
    vi.stubEnv('VERCEL', '1');
    const lower = getCartQuotaClientIdentity(
      requestWith({ 'x-baci-client-credential': CREDENTIAL_A }),
      MERCHANT_ID
    );
    const upper = getCartQuotaClientIdentity(
      requestWith({
        'x-baci-client-credential': CREDENTIAL_A.toUpperCase(),
      }),
      MERCHANT_ID
    );
    expect(upper).toBe(lower);
  });

  it('falls back to the legacy trusted network identity without a credential', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      getCartQuotaClientIdentity(
        requestWith({ 'x-real-ip': '192.0.2.44' }),
        MERCHANT_ID
      )
    ).toBe('192.0.2.44');
  });

  it('falls back when the credential is malformed', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      getCartQuotaClientIdentity(
        requestWith({
          'x-baci-client-credential': 'not-a-credential',
          'x-real-ip': '192.0.2.44',
        }),
        MERCHANT_ID
      )
    ).toBe('192.0.2.44');
  });
});

describe('checkAnonymousCartQuota', () => {
  const create = { merchantId: MERCHANT_ID, operation: 'create' } as const;

  it('bounds credential rotation with the non-rotatable network backstop', async () => {
    vi.stubEnv('VERCEL', '1');
    // Healthy store: the full 25x backstop applies (degraded mode
    // caps it at the primary ceiling — covered separately below).
    useHealthyRedis();
    __resetCartQuotaStoreForTesting();
    const backstopLimit = CART_QUOTA_BUDGETS.create_network_backstop.limit;
    // Every call rotates to a fresh credential from one network
    // address: per-credential budgets never trip, so only the
    // network backstop can stop this.
    for (let attempt = 0; attempt < backstopLimit; attempt++) {
      const result = await checkAnonymousCartQuota(
        requestWith({
          'x-baci-client-credential': rotatedCredential(attempt),
          'x-real-ip': '192.0.2.44',
        }),
        create
      );
      expect(result.allowed).toBe(true);
    }
    const denied = await checkAnonymousCartQuota(
      requestWith({
        'x-baci-client-credential': rotatedCredential(backstopLimit),
        'x-real-ip': '192.0.2.44',
      }),
      create
    );
    expect(denied.allowed).toBe(false);
  });

  it('keeps per-credential budgets independent below the backstop', async () => {
    vi.stubEnv('VERCEL', '1');
    // Per-credential fairness applies while the shared store is
    // healthy; degraded mode falls back to network identity (below).
    useHealthyRedis();
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

  it('stops minting degraded-store entries once one network hits its backstop', async () => {
    vi.stubEnv('VERCEL', '1');
    __resetCartQuotaStoreForTesting();
    // No Redis in this suite: bootstrap runs on the bounded
    // per-instance memory store. Rotating credentials from one
    // network must stop creating store entries once the degraded
    // ceiling trips, or one host could exhaust the instance's
    // fallback capacity for every shopper. The degraded ceiling is
    // the same with or without a credential header.
    const degradedBackstop = DEGRADED_BOOTSTRAP_LIMIT;
    const bootstrap = {
      merchantId: MERCHANT_ID,
      operation: 'bootstrap',
    } as const;
    let allowed = 0;
    for (let attempt = 0; attempt < degradedBackstop + 100; attempt++) {
      const result = await checkAnonymousCartQuota(
        requestWith({
          'x-baci-client-credential': rotatedCredential(attempt),
          'x-real-ip': '192.0.2.44',
        }),
        bootstrap
      );
      if (result.allowed) allowed += 1;
    }
    // A credential header never raises the degraded ceiling above
    // the legacy caller's: exactly the degraded limit got through.
    expect(allowed).toBe(DEGRADED_BOOTSTRAP_LIMIT);
    // While degraded, the credential dimension is skipped entirely:
    // only the single network backstop entry exists, however many
    // credentials rotate through it.
    expect(bootstrapMemoryCounters.size).toBe(1);
    const denied = await checkAnonymousCartQuota(
      requestWith({
        'x-baci-client-credential': rotatedCredential(9999),
        'x-real-ip': '192.0.2.44',
      }),
      bootstrap
    );
    expect(denied.allowed).toBe(false);
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
