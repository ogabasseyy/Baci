import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartPrincipal } from '@/lib/cart/principal';
import { __resetCartQuotaStoreForTesting } from '@/lib/cart/request-context';
import { issueCartSessionProof } from '@/lib/cart/session-proof';
import { POST } from './route';

const MERCHANT = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'ogabassey',
};
const CART_ID = '22222222-2222-4222-8222-222222222222';
const GRANT_ID = '33333333-3333-4333-8333-333333333333';
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_ID = '55555555-5555-4555-8555-555555555555';
const TEST_SECRET = 'test-cart-session-secret-min-32-chars!!';

const mocks = vi.hoisted(() => ({
  alias: null as string | null,
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
  createCartScopedClient: (_principal: CartPrincipal) => ({
    rpc: vi.fn(async () => ({
      data: mocks.cartPayload,
      error: mocks.cartError,
    })),
  }),
}));

function rawSnapshot() {
  return {
    cartId: CART_ID,
    cartVersion: 3,
    checkoutSessionId: SESSION_ID,
    estimates: {
      currency: 'NGN',
      lineCount: 1,
      subtotalMinor: 25000,
      unavailableCount: 0,
    },
    generation: 1,
    lines: [
      {
        assuranceRate: null,
        available: true,
        condition: null,
        effectiveUnitPriceMinor: 25000,
        hasAssurance: false,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
        lastUnitPriceMinor: 25000,
        manageStock: true,
        negotiatedUnitPriceMinor: null,
        negotiationInvalidated: false,
        negotiationStatus: null,
        options: {},
        priceChanged: false,
        productId: PRODUCT_ID,
        quantity: 1,
        stockQty: 10,
        unavailableReason: null,
        validatedUnitPriceMinor: 25000,
        variantId: null,
        voucherAwardId: null,
        voucherToken: null,
      },
    ],
    merchantId: MERCHANT.id,
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

function postPrepare(init: {
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
      'https://ogabassey.usebaci.com/api/storefront/cart/checkout',
      {
        body: init.rawBody ?? JSON.stringify(init.body ?? {}),
        headers,
        method: 'POST',
      }
    )
  );
}

function prepareBody(overrides: Record<string, unknown> = {}) {
  return {
    cartId: CART_ID,
    expectedVersion: 3,
    operationId: 'prep-op-1',
    ...overrides,
  };
}

function proofHeaders(proof: string = sessionProof()) {
  return { cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${proof}` };
}

function proofExpSeconds(proof: string): number {
  const payload = JSON.parse(
    Buffer.from(proof.split('.')[1], 'base64url').toString('utf8')
  ) as { exp: number };
  return payload.exp;
}

function sessionProofExpiringAt(iso: string): string {
  return issueCartSessionProof(
    {
      cartId: CART_ID,
      grantId: GRANT_ID,
      grantExpiresAt: iso,
      merchantId: MERCHANT.id,
      principalId: 'guest-a1',
      scope: 'session',
    },
    { environment: 'test', secret: TEST_SECRET }
  );
}

describe('POST /api/storefront/cart/checkout', () => {
  it('returns the authoritative snapshot with the session reference', async () => {
    const sessionExpiresAt = new Date(Date.now() + 25 * 60 * 1000);
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      sessionExpiresAt: sessionExpiresAt.toISOString(),
      sessionReused: false,
      snapshot: rawSnapshot(),
    };

    const incoming = sessionProof();
    const response = await postPrepare({
      body: prepareBody(),
      headers: proofHeaders(incoming),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    // Preparation renews the session proof (body + cookie). The renewed
    // proof never shortens the credential already held: the incoming
    // 24-hour proof outlives the 25-minute session, so its expiry wins.
    expect(payload.proof).toMatch(/^cp1\./);
    expect(proofExpSeconds(payload.proof)).toBe(proofExpSeconds(incoming));
    expect(response.headers.get('set-cookie')).toContain('Max-Age=');
    expect(payload.replayed).toBe(false);
    expect(payload.sessionReused).toBe(false);
    expect(payload.snapshot.checkoutSessionId).toBe(SESSION_ID);
    expect(payload.snapshot.generation).toBe(1);
    expect(payload.snapshot.lines).toHaveLength(1);
    expect(payload.snapshot.estimates.subtotalMinor).toBe(25000);
  });

  it('extends a short-lived proof to the prepared session expiry', async () => {
    const sessionExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      sessionExpiresAt: sessionExpiresAt.toISOString(),
      sessionReused: true,
      snapshot: rawSnapshot(),
    };
    const incoming = sessionProofExpiringAt(
      new Date(Date.now() + 10 * 60 * 1000).toISOString()
    );

    const response = await postPrepare({
      body: prepareBody({ operationId: 'prep-op-extend' }),
      headers: proofHeaders(incoming),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(proofExpSeconds(payload.proof)).toBe(
      Math.floor(sessionExpiresAt.getTime() / 1000)
    );
  });

  it('surfaces reuse on a repeated preparation', async () => {
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      sessionExpiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      sessionReused: true,
      snapshot: rawSnapshot(),
    };

    const response = await postPrepare({
      body: prepareBody({ operationId: 'prep-op-2' }),
      headers: proofHeaders(),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sessionReused).toBe(true);
    expect(payload.snapshot.checkoutSessionId).toBe(SESSION_ID);
  });

  it('answers refresh_required with the live version on drift', async () => {
    mocks.cartPayload = {
      code: 'refresh_required',
      currentVersion: 4,
      ok: false,
      replayed: false,
      snapshot: null,
    };

    const response = await postPrepare({
      body: prepareBody(),
      headers: proofHeaders(),
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.code).toBe('refresh_required');
    expect(payload.currentVersion).toBe(4);
  });

  it('reports a missing cart for a bootstrap principal', async () => {
    const response = await postPrepare({
      body: prepareBody(),
      headers: proofHeaders(bootstrapProof()),
    });

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('not_found');
  });

  it('rejects a cart id outside the proof without calling the cart RPC', async () => {
    const response = await postPrepare({
      body: prepareBody({ cartId: '99999999-9999-4999-8999-999999999999' }),
      headers: proofHeaders(),
    });

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('unauthorized');
  });

  it('rejects malformed bodies', async () => {
    const response = await postPrepare({
      body: { cartId: CART_ID, expectedVersion: 3 },
      headers: proofHeaders(),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_request');
  });

  it('requires CSRF protection', async () => {
    const response = await postPrepare({
      body: prepareBody(),
      headers: proofHeaders(),
      noCsrf: true,
    });

    expect(response.status).toBe(403);
  });
});
