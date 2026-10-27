import { NextRequest } from 'next/server';
import { afterEach, beforeEach, vi } from 'vitest';
import type { CartPrincipal } from '@/lib/cart/principal';
import { __resetCartQuotaStoreForTesting } from '@/lib/cart/request-context';
import { issueCartSessionProof } from '@/lib/cart/session-proof';
import { GET, POST } from './route';

export const MERCHANT = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'ogabassey',
};
export const OTHER_MERCHANT = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  slug: 'second-store',
};
export const CART_ID = '22222222-2222-4222-8222-222222222222';
export const GRANT_ID = '33333333-3333-4333-8333-333333333333';
export const PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
export const TEST_SECRET = 'test-cart-session-secret-min-32-chars!!';

const mocks = vi.hoisted(() => ({
  alias: null as string | null,
  capturedPrincipal: null as CartPrincipal | null,
  cartError: null as unknown,
  cartPayload: null as unknown,
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
      rpc: vi.fn(async () => ({
        data: mocks.cartPayload,
        error: mocks.cartError,
      })),
    };
  },
}));

export function merchantRow(
  merchant: { id: string; slug: string },
  overrides: Record<string, unknown> = {}
) {
  return {
    business_name: `${merchant.slug} store`,
    custom_domain: null,
    id: merchant.id,
    is_published: true,
    slug: merchant.slug,
    ...overrides,
  };
}

export function rawState(overrides: Record<string, unknown> = {}) {
  return {
    cartId: CART_ID,
    checkoutSessionId: null,
    currency: 'NGN',
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    lines: [],
    merchantId: MERCHANT.id,
    replayed: false,
    state: 'active',
    version: 1,
    ...overrides,
  };
}

export function rawLine(overrides: Record<string, unknown> = {}) {
  return {
    assuranceRate: null,
    available: true,
    condition: null,
    hasAssurance: false,
    id: 'line-1',
    manageStock: false,
    negotiatedUnitPriceMinor: null,
    negotiationInvalidated: false,
    negotiationStatus: null,
    options: {},
    productId: PRODUCT_ID,
    quantity: 2,
    stockQty: null,
    unitPriceMinor: 2500,
    variantId: null,
    voucherAwardId: null,
    voucherToken: null,
    ...overrides,
  };
}

export function sessionProof(merchantId: string = MERCHANT.id): string {
  return issueCartSessionProof(
    {
      cartId: CART_ID,
      grantId: GRANT_ID,
      merchantId,
      principalId: 'guest-a1',
      scope: 'session',
    },
    { environment: 'test', secret: TEST_SECRET }
  );
}

export function bootstrapProof(): string {
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

export function bootstrapProofFor(principalId: string): string {
  return issueCartSessionProof(
    {
      cartId: null,
      grantId: null,
      merchantId: MERCHANT.id,
      principalId,
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
  mocks.merchantError = null;
  mocks.merchantRows = [merchantRow(MERCHANT)];
  process.env.CART_SESSION_SECRET = TEST_SECRET;
});

afterEach(() => {
  vi.useRealTimers();
  __resetCartQuotaStoreForTesting();
  if (savedSecret === undefined) {
    delete process.env.CART_SESSION_SECRET;
  } else {
    process.env.CART_SESSION_SECRET = savedSecret;
  }
});

export const CART_URL = 'https://ogabassey.usebaci.com/api/storefront/cart';

export function cartCookie(
  proof: string,
  merchantId: string = MERCHANT.id
): string {
  return `baci-cart-${merchantId}=${proof}`;
}

export function getCart(init: {
  url?: string;
  headers?: Record<string, string>;
  noMerchantHeader?: boolean;
}) {
  return GET(
    new NextRequest(init.url ?? CART_URL, {
      headers: {
        ...init.headers,
        ...(init.noMerchantHeader ? {} : { 'x-merchant-slug': MERCHANT.slug }),
      },
      method: 'GET',
    })
  );
}

export function postCart(init: {
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
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
    new NextRequest(init.url ?? CART_URL, {
      body: JSON.stringify(init.body ?? {}),
      headers,
      method: 'POST',
    })
  );
}

export { mocks };
