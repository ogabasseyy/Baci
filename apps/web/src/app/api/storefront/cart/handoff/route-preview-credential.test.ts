import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCartQuotaClientIdentity } from '@/lib/cart/quota-identity';
import {
  __resetCartQuotaStoreForTesting,
  checkCartQuota,
} from '@/lib/cart/request-context';
import { GET } from './route';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const CART_ID = '22222222-2222-4222-8222-222222222222';
const TEST_SECRET = 'test-cart-session-secret-min-32-chars!!';
const HANDOFF_URL = 'https://ogabassey.usebaci.com/api/storefront/cart/handoff';

const mocks = vi.hoisted(() => ({
  handoffMerchantId: null as string | null,
  merchantRows: [] as unknown[],
  previewPayload: null as unknown,
}));

const mockGetRedis = vi.hoisted(() => vi.fn(() => null as unknown));

vi.mock('@/lib/redis', () => ({ getRedis: mockGetRedis }));

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
    rpc: vi.fn(async () => ({ data: mocks.merchantRows, error: null })),
  }),
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: async () => null,
}));

vi.mock('@/lib/cart/scoped-client', () => ({
  createCartPreviewClient: () => ({
    rpc: vi.fn(async (name: string) => {
      if (name === 'commerce_cart_handoff_merchant') {
        return { data: mocks.handoffMerchantId, error: null };
      }
      return { data: mocks.previewPayload, error: null };
    }),
  }),
  createCartScopedClient: () => ({
    rpc: vi.fn(async () => ({ data: null, error: null })),
  }),
}));

/** Healthy shared quota store: per-key counting fake Redis. */
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

function merchantRow() {
  return {
    business_name: 'Oga Store',
    custom_domain: null,
    id: MERCHANT_ID,
    is_published: true,
    slug: 'ogabassey',
  };
}

function rawState() {
  return {
    cartId: CART_ID,
    checkoutSessionId: null,
    currency: 'NGN',
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    lines: [],
    merchantId: MERCHANT_ID,
    replayed: false,
    state: 'active',
    version: 3,
  };
}

const savedSecret = process.env.CART_SESSION_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRedis.mockReturnValue(null);
  __resetCartQuotaStoreForTesting();
  mocks.handoffMerchantId = MERCHANT_ID;
  mocks.merchantRows = [merchantRow()];
  mocks.previewPayload = {
    code: null,
    expiresAt: '2026-10-12T06:05:00.000Z',
    merchant: { id: MERCHANT_ID, slug: 'ogabassey' },
    ok: true,
    snapshot: rawState(),
    status: 'pending',
  };
  process.env.CART_SESSION_SECRET = TEST_SECRET;
});

afterEach(() => {
  mockGetRedis.mockReturnValue(null);
  __resetCartQuotaStoreForTesting();
  if (savedSecret === undefined) {
    delete process.env.CART_SESSION_SECRET;
  } else {
    process.env.CART_SESSION_SECRET = savedSecret;
  }
});

function getPreview(headers: Record<string, string>) {
  return GET(
    new NextRequest(
      `${HANDOFF_URL}?handoff_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
      {
        headers: { 'x-handoff-token': 'ch1.fixture.token', ...headers },
        method: 'GET',
      }
    )
  );
}

describe('GET /api/storefront/cart/handoff client credential quotas', () => {
  it('keys preview quotas on the client credential when one is presented', async () => {
    // Per-credential fairness applies while the shared store is healthy.
    useHealthyRedis();
    const credentialA = {
      'x-baci-client-credential': '11111111-1111-4111-8111-111111111111',
    };
    const credentialB = {
      'x-baci-client-credential': '22222222-2222-4222-8222-222222222222',
    };
    const probe = new NextRequest(
      `${HANDOFF_URL}?handoff_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      { headers: credentialA, method: 'GET' }
    );
    const subject = getCartQuotaClientIdentity(probe, 'handoff-preview');
    for (let index = 0; index < 120; index += 1) {
      await checkCartQuota({
        merchantId: 'handoff-preview',
        operation: 'handoff_preview',
        subject,
      });
    }
    const exhausted = await getPreview(credentialA);
    expect(exhausted.status).toBe(429);
    // A different shopper behind the same network identity still previews.
    const otherShopper = await getPreview(credentialB);
    expect(otherShopper.status).not.toBe(429);
  });
});
