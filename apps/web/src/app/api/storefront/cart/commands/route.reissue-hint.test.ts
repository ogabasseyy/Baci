import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCartMerchantLookupCacheForTesting,
  __resetCartQuotaStoreForTesting,
} from '@/lib/cart/request-context';
import { issueCartSessionProof } from '@/lib/cart/session-proof';
import { POST } from './route';

const MERCHANT = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'ogabassey',
};
const CART_ID = '22222222-2222-4222-8222-222222222222';
const GRANT_ID = '33333333-3333-4333-8333-333333333333';
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
const TEST_SECRET = 'test-cart-session-secret-min-32-chars!!';

const mocks = vi.hoisted(() => ({
  cartPayload: null as unknown,
  grantAuthority: null as unknown,
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
    rpc: vi.fn(async () => ({
      data: [
        {
          business_name: 'Oga Store',
          custom_domain: null,
          id: MERCHANT.id,
          is_published: true,
          slug: MERCHANT.slug,
        },
      ],
      error: null,
    })),
  }),
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: async () => null,
}));

vi.mock('@/lib/cart/scoped-client', () => ({
  createCartScopedClient: () => ({
    rpc: vi.fn(async (name: string) =>
      name === 'commerce_cart_grant_operations' && mocks.grantAuthority
        ? { data: mocks.grantAuthority, error: null }
        : { data: mocks.cartPayload, error: null }
    ),
  }),
}));

function rawState(overrides: Record<string, unknown> = {}) {
  return {
    cartId: CART_ID,
    checkoutSessionId: null,
    currency: 'NGN',
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    lines: [],
    merchantId: MERCHANT.id,
    replayed: false,
    state: 'active',
    version: 2,
    ...overrides,
  };
}

function rawLine() {
  return {
    assuranceRate: null,
    available: true,
    condition: null,
    hasAssurance: false,
    id: `${PRODUCT_ID}:new:`,
    manageStock: false,
    negotiatedUnitPriceMinor: null,
    negotiationInvalidated: false,
    negotiationStatus: null,
    options: {},
    productId: PRODUCT_ID,
    quantity: 1,
    stockQty: null,
    unitPriceMinor: 2500,
    variantId: null,
    voucherAwardId: null,
    voucherToken: null,
  };
}

function sessionProof(): string {
  return issueCartSessionProof(
    {
      cartId: CART_ID,
      grantId: GRANT_ID,
      merchantId: MERCHANT.id,
      principalId: 'guest-a1',
      scope: 'session',
    },
    { environment: 'test', secret: TEST_SECRET }
  );
}

const savedSecret = process.env.CART_SESSION_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  __resetCartQuotaStoreForTesting();
  __resetCartMerchantLookupCacheForTesting();
  mocks.cartPayload = null;
  mocks.grantAuthority = null;
  process.env.CART_SESSION_SECRET = TEST_SECRET;
});

afterEach(() => {
  __resetCartQuotaStoreForTesting();
  if (savedSecret === undefined) {
    delete process.env.CART_SESSION_SECRET;
  } else {
    process.env.CART_SESSION_SECRET = savedSecret;
  }
});

function postAddCommand(operationId: string) {
  return POST(
    new NextRequest(
      'https://ogabassey.usebaci.com/api/storefront/cart/commands',
      {
        body: JSON.stringify({
          command: {
            item: { productId: PRODUCT_ID },
            quantity: 1,
            type: 'add',
          },
          expectedVersion: 1,
          operationId,
        }),
        headers: {
          'x-csrf-token': 'csrf-1',
          cookie: `csrf-token=csrf-1; baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
          'x-merchant-slug': MERCHANT.slug,
        },
        method: 'POST',
      }
    )
  );
}

describe('POST /api/storefront/cart/commands proof reissue & hint cookies', () => {
  it('keeps the committed cart and sets hint cookie without renewing proof when grant reload throws', async () => {
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      state: rawState({ lines: [rawLine()] }),
    };
    mocks.grantAuthority = { ok: true, allowedOperations: 'not-a-list' };
    const response = await postAddCommand('grant-reload-throws');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.cart.version).toBe(2);
    expect(payload.proof).toBeUndefined();
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).not.toContain('baci-cart-11111111-');
    expect(setCookie).toContain('baci-cart-hint-11111111-');
  });

  it('returns the committed cart with hint cookie and no renewed proof when reissue crosses grant expiry', async () => {
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      state: rawState({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        lines: [rawLine()],
      }),
    };
    const response = await postAddCommand('expired-reissue');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.cart.version).toBe(2);
    expect(payload.proof).toBeUndefined();
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).not.toContain('baci-cart-11111111-');
    expect(setCookie).toContain('baci-cart-hint-11111111-');
  });
});
