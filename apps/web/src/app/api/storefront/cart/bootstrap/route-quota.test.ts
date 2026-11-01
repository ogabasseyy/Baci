import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCartQuotaStoreForTesting } from '@/lib/cart/request-context';
import {
  CART_QUOTA_BUDGETS,
  DEGRADED_BOOTSTRAP_LIMIT,
} from '@/lib/cart/request-quota';
import { getCart } from '@/lib/cart/service';
import { POST } from './route';

const mockGetRedis = vi.hoisted(() => vi.fn(() => null as unknown));
const mockSupabaseCounter = vi.hoisted(() => vi.fn());

vi.mock('@/lib/redis', () => ({ getRedis: mockGetRedis }));
vi.mock('@/lib/cart/supabase-quota-counter', () => ({
  incrementSupabaseQuotaCounter: mockSupabaseCounter,
}));

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

vi.mock('@/lib/cart/scoped-client', () => ({
  createCartScopedClient: vi.fn(() => ({})),
}));
vi.mock('@/lib/cart/service', () => ({ getCart: vi.fn() }));

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const TEST_SECRET = 'test-cart-session-secret-min-32-chars!!';

const mocks = vi.hoisted(() => ({
  alias: null as string | null,
  merchantError: null as unknown,
  merchantRows: [] as unknown[],
  rpcCalls: 0,
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: { premium_features: ['shared_cart'] },
            error: null,
          })),
        })),
      })),
    })),
    rpc: vi.fn(async () => {
      mocks.rpcCalls += 1;
      return {
        data: mocks.merchantRows,
        error: mocks.merchantError,
      };
    }),
  }),
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: async () => mocks.alias,
}));

function merchantRow(overrides: Record<string, unknown> = {}) {
  return {
    business_name: 'Oga Store',
    custom_domain: null,
    id: MERCHANT_ID,
    is_published: true,
    slug: 'ogabassey',
    ...overrides,
  };
}

const savedSecret = process.env.CART_SESSION_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCart).mockResolvedValue({
    ok: true,
    cart: { state: 'active' },
  } as never);
  __resetCartQuotaStoreForTesting();
  mocks.alias = null;
  mocks.merchantError = null;
  mocks.merchantRows = [merchantRow()];
  mocks.rpcCalls = 0;
  process.env.CART_SESSION_SECRET = TEST_SECRET;
});

afterEach(() => {
  vi.unstubAllEnvs();
  mockGetRedis.mockReturnValue(null);
  __resetCartQuotaStoreForTesting();
  if (savedSecret === undefined) {
    delete process.env.CART_SESSION_SECRET;
  } else {
    process.env.CART_SESSION_SECRET = savedSecret;
  }
});

function postBootstrap(init: {
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  noCsrf?: boolean;
}) {
  const headers: Record<string, string> = {
    ...(init.noCsrf
      ? {}
      : { 'x-csrf-token': 'csrf-1', cookie: 'csrf-token=csrf-1' }),
    ...init.headers,
  };
  return POST(
    new NextRequest(
      init.url ?? 'https://ogabassey.usebaci.com/api/storefront/cart/bootstrap',
      {
        body:
          init.rawBody ??
          (init.body === undefined ? undefined : JSON.stringify(init.body)),
        headers: {
          ...headers,
          'x-merchant-slug': 'ogabassey',
        },
        method: 'POST',
      }
    )
  );
}

describe('POST /api/storefront/cart/bootstrap quota', () => {
  // The unit environment has no Redis, so the per-instance degraded
  // bootstrap ceiling is the bound these route tests observe.
  it('uses one failed Supabase attempt across both bootstrap scopes', async () => {
    vi.stubEnv('CART_QUOTA_BACKEND', 'supabase');
    mockSupabaseCounter.mockRejectedValue(new Error('unavailable'));
    const response = await postBootstrap({
      body: {},
      headers: {
        'x-baci-client-credential': '11111111-1111-4111-8111-111111111111',
      },
    });
    expect(response.status).toBe(201);
    expect(mockSupabaseCounter).toHaveBeenCalledTimes(1);
    expect(mockGetRedis).not.toHaveBeenCalled();
  });

  it('bounds anonymous bootstraps per merchant and client', async () => {
    let response = await postBootstrap({ body: {} });
    expect(response.status).toBe(201);

    for (let attempt = 1; attempt < DEGRADED_BOOTSTRAP_LIMIT; attempt++) {
      response = await postBootstrap({ body: {} });
      expect(response.status).toBe(201);
    }
    response = await postBootstrap({ body: {} });
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('quota_exceeded');
  });

  it('gives distinct client credentials independent budgets behind one network identity', async () => {
    // Per-credential fairness applies while the shared store is
    // healthy. Every request here shares the same legacy network
    // identity (no platform address, so the fallback bucket is
    // common). Distinct client credentials must still receive
    // independent budgets: this is the shared-egress failure that
    // took guest carts down.
    useHealthyRedis();
    const credentialA = {
      'x-baci-client-credential': '11111111-1111-4111-8111-111111111111',
    };
    const credentialB = {
      'x-baci-client-credential': '22222222-2222-4222-8222-222222222222',
    };
    for (
      let attempt = 0;
      attempt < CART_QUOTA_BUDGETS.bootstrap.limit;
      attempt++
    ) {
      const response = await postBootstrap({ body: {}, headers: credentialA });
      expect(response.status).toBe(201);
    }
    const exhausted = await postBootstrap({ body: {}, headers: credentialA });
    expect(exhausted.status).toBe(429);
    // The second shopper behind the same egress is unaffected, and so
    // is a legacy client with no credential.
    const otherShopper = await postBootstrap({
      body: {},
      headers: credentialB,
    });
    expect(otherShopper.status).toBe(201);
    const legacy = await postBootstrap({ body: {} });
    expect(legacy.status).toBe(201);
  });

  it('performs no merchant resolution once the pre-resolution quota is exhausted', async () => {
    for (let attempt = 0; attempt < DEGRADED_BOOTSTRAP_LIMIT; attempt++) {
      const response = await postBootstrap({ body: {} });
      expect(response.status).toBe(201);
    }
    mocks.rpcCalls = 0;
    const response = await postBootstrap({ body: {} });
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('quota_exceeded');
    expect(mocks.rpcCalls).toBe(0);
  });
});
