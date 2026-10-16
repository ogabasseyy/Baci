import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartPrincipal } from '@/lib/cart/principal';
import { __resetCartQuotaStoreForTesting } from '@/lib/cart/request-context';
import {
  issueCartSessionProof,
  verifyCartSessionProof,
} from '@/lib/cart/session-proof';
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
  alias: null as string | null,
  capturedPrincipal: null as CartPrincipal | null,
  cartError: null as unknown,
  cartPayload: null as unknown,
  grantAuthority: null as unknown,
  merchantError: null as unknown,
  merchantRows: [] as unknown[],
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
      data: mocks.merchantRows,
      error: mocks.merchantError,
    })),
  }),
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: async () => mocks.alias,
}));

vi.mock('@/lib/cart/scoped-client', () => ({
  createCartScopedClient: (principal: CartPrincipal) => {
    mocks.capturedPrincipal = principal;
    return {
      rpc: vi.fn(async (name: string) =>
        name === 'commerce_cart_grant_operations' && mocks.grantAuthority
          ? { data: mocks.grantAuthority, error: null }
          : { data: mocks.cartPayload, error: mocks.cartError }
      ),
    };
  },
}));

function rawState(overrides: Record<string, unknown> = {}) {
  return {
    cartId: CART_ID,
    checkoutSessionId: null,
    currency: 'NGN',
    expiresAt: '2026-10-19T04:00:00Z',
    lines: [],
    merchantId: MERCHANT.id,
    replayed: false,
    state: 'active',
    version: 2,
    ...overrides,
  };
}

function rawLine(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
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

function _bootstrapProof(): string {
  return issueCartSessionProof(
    {
      cartId: null,
      grantId: null,
      merchantId: MERCHANT.id,
      principalId: 'guest-new',
      scope: 'bootstrap',
    },
    { environment: 'test', secret: TEST_SECRET }
  );
}

const savedSecret = process.env.CART_SESSION_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  __resetCartQuotaStoreForTesting();
  mocks.alias = null;
  mocks.capturedPrincipal = null;
  mocks.cartError = null;
  mocks.cartPayload = null;
  mocks.grantAuthority = null;
  mocks.merchantError = null;
  mocks.merchantRows = [
    {
      business_name: 'Oga Store',
      custom_domain: null,
      id: MERCHANT.id,
      is_published: true,
      slug: MERCHANT.slug,
    },
  ];
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

function postCommand(init: {
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  noCsrf?: boolean;
}) {
  const headers: Record<string, string> = {
    ...(init.noCsrf
      ? {}
      : { 'x-csrf-token': 'csrf-1', cookie: 'csrf-token=csrf-1' }),
    ...init.headers,
    'x-merchant-slug': MERCHANT.slug,
  };
  if (init.headers?.cookie && !init.noCsrf) {
    headers.cookie = `csrf-token=csrf-1; ${init.headers.cookie}`;
  }
  return POST(
    new NextRequest(
      'https://ogabassey.usebaci.com/api/storefront/cart/commands',
      {
        body: init.rawBody ?? JSON.stringify(init.body ?? {}),
        headers,
        method: 'POST',
      }
    )
  );
}

function addCommand(operationId: string, expectedVersion = 1) {
  return {
    command: { item: { productId: PRODUCT_ID }, quantity: 1, type: 'add' },
    expectedVersion,
    operationId,
  };
}

describe('POST cart command proof renewal', () => {
  it('renews the proof with the live grant operations, not the stale proof operations', async () => {
    const grantExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mocks.grantAuthority = {
      ok: true,
      allowedOperations: ['add'],
      grantExpiresAt: grantExpiry,
    };
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      state: rawState({ expiresAt: grantExpiry, lines: [rawLine()] }),
    };
    const response = await postCommand({
      body: addCommand('narrowed-proof'),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
      },
    });
    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie') ?? '';
    const cookieProof = setCookie.match(/baci-cart-[^=]+=([^;]+)/)?.[1] ?? '';
    const verified = verifyCartSessionProof(cookieProof, {
      secret: TEST_SECRET,
      environment: 'test',
    });
    expect(verified).toMatchObject({
      ok: true,
      session: { allowedOperations: ['add'] },
    });
  });
});
