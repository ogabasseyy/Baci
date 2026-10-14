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
  merchantError: null as unknown,
  merchantRows: [] as unknown[],
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({
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

function bootstrapProof(): string {
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

describe('POST /api/storefront/cart/commands', () => {
  it('applies a versioned command for a session principal', async () => {
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      state: rawState({ lines: [rawLine()] }),
    };

    const response = await postCommand({
      body: addCommand('op-1'),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const payload = await response.json();
    expect(payload.operationId).toBe('op-1');
    expect(payload.replayed).toBe(false);
    expect(payload.cart.version).toBe(2);
    expect(mocks.capturedPrincipal).toMatchObject({
      cartId: CART_ID,
      merchantId: MERCHANT.id,
      scope: 'session',
    });
  });

  it('renews the session proof after an authorized mutation', async () => {
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      state: rawState({ expiresAt: expiry, lines: [rawLine()] }),
    };
    const response = await postCommand({
      body: addCommand('renew-proof'),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
      },
    });
    const payload = await response.json();
    expect(payload.proof).toEqual(expect.any(String));
    expect(response.headers.get('set-cookie')).toContain(
      'baci-cart-11111111-1111-4111-8111-111111111111='
    );
    const verified = verifyCartSessionProof(payload.proof, {
      secret: TEST_SECRET,
      environment: 'test',
    });
    expect(verified).toMatchObject({
      ok: true,
      session: { cartId: CART_ID, grantId: GRANT_ID },
    });
  });

  it('returns replayed outcomes for response-loss retries', async () => {
    mocks.cartPayload = {
      code: null,
      currentVersion: 3,
      ok: true,
      replayed: true,
      state: rawState({ lines: [rawLine()], version: 2 }),
    };

    const response = await postCommand({
      body: addCommand('op-1'),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
      },
    });

    expect(response.status).toBe(200);
    expect((await response.json()).replayed).toBe(true);
  });

  it('accepts native Bearer session proofs', async () => {
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      state: rawState(),
    };

    const response = await postCommand({
      body: addCommand('op-native'),
      headers: { authorization: `Bearer ${sessionProof()}` },
      noCsrf: true,
    });

    expect(response.status).toBe(200);
    expect((await response.json()).operationId).toBe('op-native');
  });

  it('rejects stale versions with the current cart for reconciliation', async () => {
    mocks.cartPayload = {
      code: 'version_conflict',
      currentVersion: 5,
      ok: false,
      replayed: false,
      state: rawState({ version: 5 }),
    };

    const response = await postCommand({
      body: addCommand('op-stale', 2),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
      },
    });

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.code).toBe('version_conflict');
    expect(payload.cart.version).toBe(5);
  });

  it('routes bootstrap proofs and missing proofs without touching carts', async () => {
    const bootstrap = await postCommand({
      body: addCommand('op-early'),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${bootstrapProof()}`,
      },
    });
    expect(bootstrap.status).toBe(404);
    expect((await bootstrap.json()).code).toBe('not_found');

    const missing = await postCommand({ body: addCommand('op-none') });
    expect(missing.status).toBe(401);
    expect((await missing.json()).code).toBe('missing_proof');
    expect(mocks.capturedPrincipal).toBeNull();
  });

  it('rejects malformed JSON and invalid commands', async () => {
    const malformed = await postCommand({
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
      },
      rawBody: '{"command":',
    });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).code).toBe('invalid_request');

    const invalid = await postCommand({
      body: { command: { type: 'teleport' }, operationId: 'op-x' },
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
      },
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).code).toBe('invalid_request');
    expect(mocks.capturedPrincipal).toBeNull();
  });

  it('rejects browser requests without a CSRF token', async () => {
    const response = await postCommand({
      body: addCommand('op-csrf'),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
      },
      noCsrf: true,
    });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('forbidden');
  });

  it('bounds commands per merchant and principal', async () => {
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      state: rawState(),
    };
    const attempt = () =>
      postCommand({
        body: addCommand('op-burst'),
        headers: {
          cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
        },
      });

    for (let index = 0; index < 240; index++) {
      expect((await attempt()).status).toBe(200);
    }
    const exhausted = await attempt();
    expect(exhausted.status).toBe(429);
    expect((await exhausted.json()).code).toBe('quota_exceeded');
  }, 60_000);
});
