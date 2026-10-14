import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartPrincipal } from '@/lib/cart/principal';
import { __resetCartQuotaStoreForTesting } from '@/lib/cart/request-context';
import {
  CART_BOOTSTRAP_PROOF_TTL_SECONDS,
  CART_SESSION_PROOF_TTL_SECONDS,
  issueCartSessionProof,
  verifyCartSessionProof,
} from '@/lib/cart/session-proof';
import { POST } from './route';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const INCOMING_CART_ID = '22222222-2222-4222-8222-222222222222';
const DEST_CART_ID = '77777777-7777-4777-8777-777777777777';
const DEST_GRANT_ID = '99999999-9999-4999-8999-999999999992';
const NEW_GRANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_SECRET = 'test-cart-session-secret-min-32-chars!!';
const TOKEN = 'ch1.payload.signature';
const HANDOFF_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mocks = vi.hoisted(() => ({
  alias: null as string | null,
  capturedPrincipal: null as CartPrincipal | null,
  cartError: null as unknown,
  cartPayload: null as unknown,
  cartRpcCalls: [] as { args: unknown; name: string }[],
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
      rpc: vi.fn(async (name: string, args: unknown) => {
        mocks.cartRpcCalls.push({ args, name });
        if (mocks.cartError instanceof Error) throw mocks.cartError;
        return { data: mocks.cartPayload, error: mocks.cartError };
      }),
    };
  },
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
    productId: '44444444-4444-4444-8444-444444444444',
    quantity: 1,
    stockQty: null,
    unitPriceMinor: 1500,
    variantId: null,
    voucherAwardId: null,
    voucherToken: null,
    ...overrides,
  };
}

function rawState(overrides: Record<string, unknown> = {}) {
  return {
    cartId: INCOMING_CART_ID,
    checkoutSessionId: null,
    currency: 'NGN',
    expiresAt: '2026-10-19T04:00:00Z',
    lines: [rawLine()],
    merchantId: MERCHANT_ID,
    replayed: false,
    state: 'active',
    version: 3,
    ...overrides,
  };
}

function destSessionProof(): string {
  return issueCartSessionProof(
    {
      cartId: DEST_CART_ID,
      grantId: DEST_GRANT_ID,
      merchantId: MERCHANT_ID,
      principalId: 'guest-dest',
      scope: 'session',
    },
    { environment: 'test', secret: TEST_SECRET }
  );
}

function destBootstrapProof(): string {
  return issueCartSessionProof(
    {
      cartId: null,
      grantId: null,
      merchantId: MERCHANT_ID,
      principalId: 'guest-fresh',
      scope: 'bootstrap',
    },
    { environment: 'test', secret: TEST_SECRET }
  );
}

const savedSecret = process.env.CART_SESSION_SECRET;
const consoleError = console.error;

beforeEach(() => {
  vi.clearAllMocks();
  __resetCartQuotaStoreForTesting();
  mocks.alias = null;
  mocks.capturedPrincipal = null;
  mocks.cartError = null;
  mocks.cartPayload = null;
  mocks.cartRpcCalls = [];
  mocks.merchantError = null;
  mocks.merchantRows = [merchantRow()];
  process.env.CART_SESSION_SECRET = TEST_SECRET;
  console.error = vi.fn();
});

afterEach(() => {
  __resetCartQuotaStoreForTesting();
  console.error = consoleError;
  if (savedSecret === undefined) {
    delete process.env.CART_SESSION_SECRET;
  } else {
    process.env.CART_SESSION_SECRET = savedSecret;
  }
});

function postRedeem(init: {
  body?: unknown;
  headers?: Record<string, string>;
  noCsrf?: boolean;
  noOrigin?: boolean;
}) {
  const headers: Record<string, string> = {
    ...(init.noCsrf
      ? {}
      : { 'x-csrf-token': 'csrf-1', cookie: 'csrf-token=csrf-1' }),
    // Browser redemptions always carry an Origin; default to the
    // merchant origin when a test does not specify its transport.
    ...(!init.noOrigin && !init.headers?.origin && !init.headers?.authorization
      ? { origin: 'https://ogabassey.usebaci.com' }
      : {}),
    ...init.headers,
    'x-merchant-slug': 'ogabassey',
  };
  if (init.headers?.cookie && !init.noCsrf) {
    headers.cookie = `csrf-token=csrf-1; ${init.headers.cookie}`;
  }
  return POST(
    new NextRequest(
      'https://ogabassey.usebaci.com/api/storefront/cart/handoff/redeem',
      {
        body: JSON.stringify(init.body ?? {}),
        headers,
        method: 'POST',
      }
    )
  );
}

function connectBody(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: 'attempt-1',
    choice: 'connect',
    expectedIncomingVersion: 3,
    handoffId: HANDOFF_ID,
    token: TOKEN,
    ...overrides,
  };
}

describe('POST /api/storefront/cart/handoff/redeem', () => {
  it('connects a fresh destination and issues its session proof', async () => {
    mocks.cartPayload = {
      choice: 'connect',
      code: null,
      currentVersion: 3,
      grantId: NEW_GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState(),
    };

    const response = await postRedeem({
      body: connectBody(),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${destBootstrapProof()}`,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const payload = await response.json();
    expect(payload.choice).toBe('connect');
    expect(payload.cart.cartId).toBe(INCOMING_CART_ID);

    const verified = verifyCartSessionProof(payload.proof, {
      environment: 'test',
      secret: TEST_SECRET,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.session.cartId).toBe(INCOMING_CART_ID);
      expect(verified.session.grantId).toBe(NEW_GRANT_ID);
      expect(verified.session.principalId).toBe('guest-fresh');
    }
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(
      `baci-cart-11111111-1111-4111-8111-111111111111=${payload.proof}`
    );
    expect(setCookie).toContain(`Max-Age=${CART_SESSION_PROOF_TTL_SECONDS}`);
    expect(mocks.capturedPrincipal).toMatchObject({
      principalId: 'guest-fresh',
      scope: 'bootstrap',
    });

    expect(mocks.cartRpcCalls).toHaveLength(1);
    const args = mocks.cartRpcCalls[0]?.args as Record<string, unknown>;
    expect(mocks.cartRpcCalls[0]?.name).toBe('commerce_cart_redeem_handoff');
    expect(args.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain('ch1.');
  });

  it('detects web and native callers from the Origin header', async () => {
    mocks.cartPayload = {
      choice: 'connect',
      code: null,
      currentVersion: 3,
      grantId: NEW_GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState(),
    };

    await postRedeem({
      body: connectBody({ attemptId: 'attempt-web' }),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${destBootstrapProof()}`,
        origin: 'https://ogabassey.usebaci.com',
      },
    });
    const webArgs = mocks.cartRpcCalls[0]?.args as Record<string, unknown>;
    expect(webArgs.p_caller).toBe('web');

    await postRedeem({
      body: connectBody({ attemptId: 'attempt-native' }),
      headers: {
        authorization: `Bearer ${destBootstrapProof()}`,
        cookie: 'csrf-token=csrf-1',
      },
      noCsrf: true,
    });
    const nativeArgs = mocks.cartRpcCalls[1]?.args as Record<string, unknown>;
    expect(nativeArgs.p_caller).toBe('native');
  });

  it('rejects native-classified redemption without the device Bearer proof', async () => {
    const response = await postRedeem({
      body: connectBody(),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${destBootstrapProof()}`,
      },
      noOrigin: true,
    });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('forbidden');
    expect(mocks.cartRpcCalls).toHaveLength(0);
  });

  it('rejects web redemption from unapproved origins', async () => {
    const response = await postRedeem({
      body: connectBody(),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${destBootstrapProof()}`,
        origin: 'https://evil.example.com',
      },
    });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('forbidden');
    expect(mocks.cartRpcCalls).toHaveLength(0);
  });

  it('merges for session destinations and reports conflicts', async () => {
    mocks.cartPayload = {
      choice: 'merge',
      code: null,
      currentVersion: 4,
      grantId: DEST_GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState({ cartId: DEST_CART_ID, version: 4 }),
    };

    const merged = await postRedeem({
      body: {
        attemptId: 'attempt-merge',
        choice: 'merge',
        destCartId: DEST_CART_ID,
        expectedDestVersion: 3,
        expectedIncomingVersion: 3,
        handoffId: HANDOFF_ID,
        lines: [
          {
            item: {
              productId: '44444444-4444-4444-8444-444444444444',
            },
            quantity: 1,
          },
        ],
        token: TOKEN,
      },
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${destSessionProof()}`,
      },
    });
    expect(merged.status).toBe(200);
    expect((await merged.json()).cart.cartId).toBe(DEST_CART_ID);

    mocks.cartPayload = {
      code: 'merge_conflict',
      conflicts: [
        {
          existing: { negotiatedUnitPriceMinor: 22000 },
          incoming: { negotiatedUnitPriceMinor: 20000 },
          item: {
            productId: '44444444-4444-4444-8444-444444444444',
          },
        },
      ],
      destVersion: 4,
      incomingVersion: 3,
      ok: false,
      replayed: false,
      state: rawState({ cartId: DEST_CART_ID, version: 4 }),
    };
    const conflicted = await postRedeem({
      body: {
        attemptId: 'attempt-merge-2',
        lines: [
          {
            item: { productId: '44444444-4444-4444-8444-444444444444' },
            quantity: 1,
          },
        ],
        choice: 'merge',
        destCartId: DEST_CART_ID,
        expectedDestVersion: 4,
        expectedIncomingVersion: 3,
        handoffId: HANDOFF_ID,
        token: TOKEN,
      },
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${destSessionProof()}`,
      },
    });
    expect(conflicted.status).toBe(409);
    const conflictPayload = await conflicted.json();
    expect(conflictPayload.code).toBe('merge_conflict');
    expect(conflictPayload.conflicts).toHaveLength(1);
    expect(conflictPayload.destVersion).toBe(4);
  });

  it('keeps existing state while reissuing destination proofs', async () => {
    mocks.cartPayload = {
      choice: 'keep_existing',
      code: null,
      currentVersion: 3,
      grantId: DEST_GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState({ cartId: DEST_CART_ID }),
    };
    const kept = await postRedeem({
      body: connectBody({ attemptId: 'attempt-keep', choice: 'keep_existing' }),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${destSessionProof()}`,
      },
    });
    expect(kept.status).toBe(200);
    const keptPayload = await kept.json();
    expect(keptPayload.cart.cartId).toBe(DEST_CART_ID);
    const keptVerified = verifyCartSessionProof(keptPayload.proof, {
      environment: 'test',
      secret: TEST_SECRET,
    });
    expect(keptVerified.ok).toBe(true);

    mocks.cartPayload = {
      choice: 'keep_existing',
      code: null,
      currentVersion: null,
      grantId: null,
      ok: true,
      replayed: false,
      state: null,
    };
    const fresh = await postRedeem({
      body: connectBody({
        attemptId: 'attempt-keep-fresh',
        choice: 'keep_existing',
      }),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${destBootstrapProof()}`,
      },
    });
    expect(fresh.status).toBe(200);
    const freshPayload = await fresh.json();
    expect(freshPayload.cart).toBeNull();
    const freshVerified = verifyCartSessionProof(freshPayload.proof, {
      environment: 'test',
      secret: TEST_SECRET,
    });
    expect(freshVerified.ok).toBe(true);
    if (freshVerified.ok) {
      expect(freshVerified.session.cartId).toBeNull();
    }
    expect(fresh.headers.get('set-cookie')).toContain(
      `Max-Age=${CART_BOOTSTRAP_PROOF_TTL_SECONDS}`
    );
  });

  it('rejects incoherent choices and stale cart references', async () => {
    const mergeWithoutCart = await postRedeem({
      body: connectBody({ attemptId: 'attempt-bad', choice: 'merge' }),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${destBootstrapProof()}`,
      },
    });
    expect(mergeWithoutCart.status).toBe(400);
    expect((await mergeWithoutCart.json()).code).toBe('invalid_request');

    const staleCart = await postRedeem({
      body: connectBody({
        attemptId: 'attempt-stale',
        choice: 'merge',
        destCartId: INCOMING_CART_ID,
      }),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${destSessionProof()}`,
      },
    });
    expect(staleCart.status).toBe(400);
    expect(mocks.cartRpcCalls).toHaveLength(0);
  });

  it('rejects missing proofs and CSRF, and maps spent links', async () => {
    const missing = await postRedeem({ body: connectBody() });
    expect(missing.status).toBe(401);

    const csrf = await postRedeem({
      body: connectBody(),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${destBootstrapProof()}`,
      },
      noCsrf: true,
    });
    expect(csrf.status).toBe(403);

    mocks.cartPayload = {
      code: 'handoff_consumed',
      ok: false,
      replayed: false,
      state: null,
    };
    const spent = await postRedeem({
      body: connectBody({ attemptId: 'attempt-spent' }),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${destBootstrapProof()}`,
      },
    });
    expect(spent.status).toBe(404);
    expect((await spent.json()).code).toBe('handoff_consumed');

    mocks.cartPayload = {
      code: 'expired',
      ok: false,
      replayed: false,
      state: null,
    };
    const stale = await postRedeem({
      body: connectBody({ attemptId: 'attempt-stale-link' }),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${destBootstrapProof()}`,
      },
    });
    expect(stale.status).toBe(404);
    expect((await stale.json()).code).toBe('expired');
  });

  it('never logs pairing material on unexpected faults', async () => {
    mocks.cartError = new Error('boom ch1.fake-pairing-token');
    const spy = console.error as unknown as ReturnType<typeof vi.fn>;

    const response = await postRedeem({
      body: connectBody(),
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${destBootstrapProof()}`,
      },
    });

    expect(response.status).toBe(503);
    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('ch1.');
    }
  });
});
