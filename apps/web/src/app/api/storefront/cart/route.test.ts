import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartPrincipal } from '@/lib/cart/principal';
import { __resetCartQuotaStoreForTesting } from '@/lib/cart/request-context';
import * as sessionProofModule from '@/lib/cart/session-proof';
import {
  CART_SESSION_PROOF_TTL_SECONDS,
  issueCartSessionProof,
  verifyCartSessionProof,
} from '@/lib/cart/session-proof';
import { GET, POST } from './route';

const MERCHANT = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'ogabassey',
};
const OTHER_MERCHANT = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  slug: 'second-store',
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

function merchantRow(
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
    version: 1,
    ...overrides,
  };
}

function rawLine(overrides: Record<string, unknown> = {}) {
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

function sessionProof(merchantId: string = MERCHANT.id): string {
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

function bootstrapProofFor(principalId: string): string {
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

const CART_URL = 'https://ogabassey.usebaci.com/api/storefront/cart';

function cartCookie(proof: string, merchantId: string = MERCHANT.id): string {
  return `baci-cart-${merchantId}=${proof}`;
}

function getCart(init: {
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

function postCart(init: {
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

describe('GET /api/storefront/cart', () => {
  it('returns the authorized snapshot without setting cookies', async () => {
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      state: rawState({ lines: [rawLine()] }),
    };

    const response = await getCart({
      headers: { cookie: cartCookie(sessionProof()) },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    const payload = await response.json();
    expect(payload.cart.cartId).toBe(CART_ID);
    expect(payload.cart.lines).toHaveLength(1);
    expect(payload.cart.totalMinor).toBe(5000);
    expect(mocks.capturedPrincipal).toMatchObject({
      cartId: CART_ID,
      merchantId: MERCHANT.id,
      principalId: 'guest-a1',
      scope: 'session',
    });
  });

  it('accepts a native Bearer session proof', async () => {
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      state: rawState(),
    };

    const response = await getCart({
      headers: { authorization: `Bearer ${sessionProof()}` },
    });

    expect(response.status).toBe(200);
    expect((await response.json()).cart.cartId).toBe(CART_ID);
  });

  it('reports a missing cart for bootstrap proofs instead of failing auth', async () => {
    const response = await getCart({
      headers: { cookie: cartCookie(bootstrapProof()) },
    });

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('not_found');
    expect(mocks.capturedPrincipal).toBeNull();
  });

  it('rejects missing proofs and foreign merchants', async () => {
    const missing = await getCart({ headers: {} });
    expect(missing.status).toBe(401);
    expect((await missing.json()).code).toBe('missing_proof');

    const foreign = await getCart({
      headers: { cookie: cartCookie(sessionProof(OTHER_MERCHANT.id)) },
    });
    expect(foreign.status).toBe(403);
    expect((await foreign.json()).code).toBe('merchant_mismatch');
  });

  it('keeps two stores on one origin separate', async () => {
    mocks.merchantRows = [merchantRow(OTHER_MERCHANT)];
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      state: rawState({ merchantId: OTHER_MERCHANT.id }),
    };
    const url =
      'https://api.usebaci.com/api/storefront/cart?merchantSlug=second-store';

    const collision = await getCart({
      headers: { cookie: cartCookie(sessionProof()) },
      noMerchantHeader: true,
      url,
    });
    expect(collision.status).toBe(401);
    expect((await collision.json()).code).toBe('missing_proof');

    const otherProof = issueCartSessionProof(
      {
        cartId: CART_ID,
        grantId: GRANT_ID,
        merchantId: OTHER_MERCHANT.id,
        principalId: 'guest-b1',
        scope: 'session',
      },
      { environment: 'test', secret: TEST_SECRET }
    );
    const separated = await getCart({
      headers: { cookie: cartCookie(otherProof, OTHER_MERCHANT.id) },
      noMerchantHeader: true,
      url,
    });
    expect(separated.status).toBe(200);
    expect(mocks.capturedPrincipal).toMatchObject({
      merchantId: OTHER_MERCHANT.id,
      principalId: 'guest-b1',
    });
  });

  it('maps outage and expiry distinctly', async () => {
    mocks.cartError = { message: 'fetch failed' };
    const outage = await getCart({
      headers: { cookie: cartCookie(sessionProof()) },
    });
    expect(outage.status).toBe(503);
    expect((await outage.json()).code).toBe('temporarily_unavailable');

    mocks.cartError = null;
    mocks.cartPayload = {
      code: 'expired',
      ok: false,
      replayed: false,
      state: null,
    };
    const expired = await getCart({
      headers: { cookie: cartCookie(sessionProof()) },
    });
    expect(expired.status).toBe(404);
    expect((await expired.json()).code).toBe('expired');
  });
});

describe('POST /api/storefront/cart', () => {
  it.each([
    'web',
    'native',
  ])('retries committed creation when %s session proof issuance fails', async (surface) => {
    const bootstrap = bootstrapProof();
    mocks.cartPayload = {
      code: null,
      grantId: GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState(),
    };
    const mint = vi
      .spyOn(sessionProofModule, 'issueCartSessionProof')
      .mockImplementationOnce(() => {
        throw new Error('fixture mint failure');
      });
    const headers: Record<string, string> =
      surface === 'web'
        ? { cookie: cartCookie(bootstrap) }
        : { authorization: `Bearer ${bootstrap}` };
    const request = {
      body: { operationId: 'create-proof-retry' },
      headers,
      noCsrf: surface === 'native',
    };
    const failed = await postCart(request);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({
      code: 'temporarily_unavailable',
    });
    expect(failed.headers.get('set-cookie')).toBeNull();
    mint.mockRestore();
    mocks.cartPayload = {
      code: null,
      grantId: GRANT_ID,
      ok: true,
      replayed: true,
      state: rawState(),
    };
    const retried = await postCart(request);
    expect(retried.status).toBe(201);
    const payload = await retried.json();
    expect(payload).toMatchObject({
      operationId: 'create-proof-retry',
      replayed: true,
      cart: { cartId: CART_ID },
    });
    const proof =
      surface === 'native'
        ? payload.proof
        : (retried.headers.get('set-cookie') ?? '').match(
            /baci-cart-[^=]+=([^;]+)/
          )?.[1];
    expect(
      verifyCartSessionProof(proof, {
        environment: 'test',
        secret: TEST_SECRET,
      }).ok
    ).toBe(true);
  });

  it('lazily creates a cart and upgrades to a session proof', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T04:00:00Z'));
    mocks.cartPayload = {
      code: null,
      grantId: GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState({ lines: [rawLine()] }),
    };

    const response = await postCart({
      body: {
        lines: [{ item: { productId: PRODUCT_ID }, quantity: 2 }],
        operationId: 'create-1',
      },
      headers: { cookie: cartCookie(bootstrapProof()) },
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const payload = await response.json();
    expect(payload.operationId).toBe('create-1');
    expect(payload.replayed).toBe(false);
    expect(payload.cart.cartId).toBe(CART_ID);

    // Web callers receive the upgraded session proof only via the
    // httpOnly cookie.
    expect(payload.proof).toBeUndefined();
    const setCookie = response.headers.get('set-cookie') ?? '';
    const cookieProof = setCookie.match(/baci-cart-[^=]+=([^;]+)/)?.[1] ?? '';
    const verified = verifyCartSessionProof(cookieProof, {
      environment: 'test',
      secret: TEST_SECRET,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.session.merchantId).toBe(MERCHANT.id);
      expect(verified.session.cartId).toBe(CART_ID);
      expect(verified.session.grantId).toBe(GRANT_ID);
    }
    expect(setCookie).toContain(
      `baci-cart-11111111-1111-4111-8111-111111111111=${cookieProof}`
    );
    expect(setCookie).toContain(`Max-Age=${CART_SESSION_PROOF_TTL_SECONDS}`);
    expect(mocks.capturedPrincipal).toMatchObject({ scope: 'bootstrap' });
  });

  it('creates for native clients presenting a Bearer bootstrap proof', async () => {
    mocks.cartPayload = {
      code: null,
      grantId: GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState(),
    };

    const response = await postCart({
      body: { operationId: 'create-native' },
      headers: { authorization: `Bearer ${bootstrapProof()}` },
      noCsrf: true,
    });

    expect(response.status).toBe(201);
    expect((await response.json()).operationId).toBe('create-native');
  });

  it('never lets client JSON override the resolved merchant', async () => {
    const response = await postCart({
      body: { merchantId: OTHER_MERCHANT.id, operationId: 'create-9' },
      headers: { cookie: cartCookie(bootstrapProof()) },
    });

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_request');
    expect(mocks.capturedPrincipal).toBeNull();
  });

  it('forbids creation for proofs that already hold a cart', async () => {
    const response = await postCart({
      body: { operationId: 'create-9' },
      headers: { cookie: cartCookie(sessionProof()) },
    });

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('unauthorized');
  });

  it('rejects browser requests without a CSRF token', async () => {
    const response = await postCart({
      body: { operationId: 'create-9' },
      headers: { cookie: cartCookie(bootstrapProof()) },
      noCsrf: true,
    });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('forbidden');
  });

  it('maps invalid lines and idempotency conflicts', async () => {
    const invalid = await postCart({
      body: {
        lines: [{ item: { productId: 'not-a-uuid' }, quantity: 1 }],
        operationId: 'create-9',
      },
      headers: { cookie: cartCookie(bootstrapProof()) },
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).code).toBe('invalid_request');

    mocks.cartPayload = {
      code: 'idempotency_conflict',
      ok: false,
      replayed: false,
      state: null,
    };
    const conflict = await postCart({
      body: { operationId: 'create-1' },
      headers: { cookie: cartCookie(bootstrapProof()) },
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe('idempotency_conflict');
  });

  it('fails closed when creation succeeds without a grant id', async () => {
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      state: rawState(),
    };

    const response = await postCart({
      body: { operationId: 'create-9' },
      headers: { cookie: cartCookie(bootstrapProof()) },
    });

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('temporarily_unavailable');
  });

  it('bounds creation per merchant and principal', async () => {
    mocks.cartPayload = {
      code: null,
      grantId: GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState(),
    };
    const attempt = () =>
      postCart({
        body: { operationId: 'create-1' },
        headers: { cookie: cartCookie(bootstrapProof()) },
      });

    for (let index = 0; index < 10; index++) {
      expect((await attempt()).status).toBe(201);
    }
    const exhausted = await attempt();
    expect(exhausted.status).toBe(429);
    expect((await exhausted.json()).code).toBe('quota_exceeded');
  });

  it('does not let rotating bootstrap proofs reset the create budget', async () => {
    mocks.cartPayload = {
      code: null,
      grantId: GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState(),
    };
    // Every attempt presents a brand-new principal (a fresh bootstrap
    // proof), but all come from the same client identity.
    for (let index = 0; index < 10; index++) {
      const response = await postCart({
        body: { operationId: `create-rot-${index}` },
        headers: {
          cookie: cartCookie(bootstrapProofFor(`guest-rot-${index}`)),
        },
      });
      expect(response.status).toBe(201);
    }
    const exhausted = await postCart({
      body: { operationId: 'create-rot-10' },
      headers: { cookie: cartCookie(bootstrapProofFor('guest-rot-10')) },
    });
    expect(exhausted.status).toBe(429);
    expect((await exhausted.json()).code).toBe('quota_exceeded');
  });
});
