import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCartQuotaStoreForTesting } from '@/lib/cart/request-context';
import { getCart } from '@/lib/cart/service';
import {
  CART_BOOTSTRAP_PROOF_TTL_SECONDS,
  issueCartSessionProof,
  verifyCartSessionProof,
} from '@/lib/cart/session-proof';
import { POST } from './route';

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

function cookieValue(setCookie: string | null, name: string): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1] ?? null;
}

describe('POST /api/storefront/cart/bootstrap', () => {
  it('mints a verifiable bootstrap proof without creating a cart', async () => {
    const response = await postBootstrap({ body: {} });

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const payload = await response.json();
    expect(payload.merchant).toEqual({ id: MERCHANT_ID, slug: 'ogabassey' });
    // Storefront-host web callers never receive the proof in the body:
    // it travels exclusively in the httpOnly cookie so page script
    // cannot lift and replay it.
    expect(payload.proof).toBeUndefined();

    const cookieProof = cookieValue(
      response.headers.get('set-cookie'),
      'baci-cart-11111111-1111-4111-8111-111111111111'
    );
    expect(cookieProof).toMatch(/^cp1\./);
    const verified = verifyCartSessionProof(cookieProof ?? '', {
      environment: 'test',
      secret: TEST_SECRET,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.session.merchantId).toBe(MERCHANT_ID);
      expect(verified.session.cartId).toBeNull();
      expect(verified.session.grantId).toBeNull();
    }
  });

  it('never downgrades a live session cookie to a bootstrap proof', async () => {
    const sessionProof = issueCartSessionProof(
      {
        cartId: '22222222-2222-4222-8222-222222222222',
        grantId: '33333333-3333-4333-8333-333333333333',
        merchantId: MERCHANT_ID,
        principalId: 'guest-live',
        scope: 'session',
      },
      { environment: 'test', secret: TEST_SECRET }
    );
    const cookieName = `baci-cart-${MERCHANT_ID}`;

    const response = await postBootstrap({
      body: {},
      headers: { cookie: `csrf-token=csrf-1; ${cookieName}=${sessionProof}` },
    });

    expect(response.status).toBe(201);
    // The live session cookie is left untouched, and the storefront
    // host receives no body proof either.
    expect((await response.json()).proof).toBeUndefined();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('does not resolve a merchant from a hint on Vercel deployment hosts', async () => {
    const response = await postBootstrap({
      body: {},
      url: 'https://baci-git-shared-cart-ogabassey.vercel.app/api/storefront/cart/bootstrap?merchantSlug=ogabassey',
    });

    // A public deployment alias is neither a tenant-binding nor a
    // credential-disclosure surface: no merchant, no proof, no cookie.
    expect(response.status).toBe(404);
    expect((await response.json()).proof).toBeUndefined();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('serves native clients that carry no cookies', async () => {
    const response = await postBootstrap({
      headers: { authorization: 'Bearer native-device-token' },
      noCsrf: true,
      url: 'https://api.usebaci.com/api/storefront/cart/bootstrap?merchantSlug=ogabassey',
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.proof.startsWith('cp1.')).toBe(true);
  });

  it('keeps the body proof off the browsable root host', async () => {
    const response = await postBootstrap({
      headers: { authorization: 'Bearer [REDACTED]' },
      noCsrf: true,
      url: 'https://usebaci.com/api/storefront/cart/bootstrap?merchantSlug=ogabassey',
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.proof).toBeUndefined();
    expect(response.headers.get('set-cookie')).toContain('cp1.');
  });

  it('rejects browser requests without a CSRF token', async () => {
    const response = await POST(
      new NextRequest(
        'https://ogabassey.usebaci.com/api/storefront/cart/bootstrap',
        {
          body: JSON.stringify({}),
          headers: { 'x-merchant-slug': 'ogabassey' },
          method: 'POST',
        }
      )
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await response.json()).code).toBe('forbidden');
  });

  it('rejects malformed JSON with a typed error', async () => {
    const response = await postBootstrap({ rawBody: '{"merchantSlug":' });

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_request');
  });

  it('reports unknown and unpublished stores distinctly', async () => {
    mocks.merchantRows = [];
    const missing = await postBootstrap({
      url: 'https://usebaci.com/api/storefront/cart/bootstrap?merchantSlug=nope',
    });
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe('merchant_unresolved');

    mocks.merchantRows = [merchantRow({ is_published: false })];
    const unpublished = await postBootstrap({ body: {} });
    expect(unpublished.status).toBe(403);
    expect((await unpublished.json()).code).toBe('merchant_unavailable');
  });

  it('requires a store hint on hosts without trusted headers', async () => {
    const response = await POST(
      new NextRequest('https://usebaci.com/api/storefront/cart/bootstrap', {
        body: JSON.stringify({}),
        headers: { 'x-csrf-token': 'csrf-1', cookie: 'csrf-token=csrf-1' },
        method: 'POST',
      })
    );

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('merchant_unresolved');
  });

  it('bounds anonymous bootstraps per merchant and client', async () => {
    let response = await postBootstrap({ body: {} });
    expect(response.status).toBe(201);

    for (let attempt = 1; attempt < 30; attempt++) {
      response = await postBootstrap({ body: {} });
      expect(response.status).toBe(201);
    }
    response = await postBootstrap({ body: {} });
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('quota_exceeded');
  });

  it('performs no merchant resolution once the pre-resolution quota is exhausted', async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await postBootstrap({ body: {} });
      expect(response.status).toBe(201);
    }
    mocks.rpcCalls = 0;
    const response = await postBootstrap({ body: {} });
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('quota_exceeded');
    expect(mocks.rpcCalls).toBe(0);
  });

  it('fails closed when the proof secret is not provisioned', async () => {
    delete process.env.CART_SESSION_SECRET;

    const response = await postBootstrap({ body: {} });

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('temporarily_unavailable');
  });

  it('advertises a short bootstrap expiry matching the cookie', async () => {
    const before = Date.now();
    const response = await postBootstrap({ body: {} });
    const payload = await response.json();

    const expiresAt = Date.parse(payload.expiresAt);
    expect(expiresAt).toBeGreaterThan(
      before + (CART_BOOTSTRAP_PROOF_TTL_SECONDS - 60) * 1000
    );
    expect(expiresAt).toBeLessThanOrEqual(
      before + (CART_BOOTSTRAP_PROOF_TTL_SECONDS + 60) * 1000
    );
    expect(response.headers.get('set-cookie')).toContain(
      `Max-Age=${CART_BOOTSTRAP_PROOF_TTL_SECONDS}`
    );
  });
});

it('replaces a terminal session cookie so the next cart starts with bootstrap authority', async () => {
  const old = issueCartSessionProof(
    {
      merchantId: MERCHANT_ID,
      principalId: 'guest-one',
      cartId: '22222222-2222-4222-8222-222222222222',
      grantId: '33333333-3333-4333-8333-333333333333',
      scope: 'session',
    },
    { secret: TEST_SECRET, environment: 'test' }
  );
  vi.mocked(getCart).mockResolvedValue({
    ok: true,
    cart: { state: 'completed' },
  } as never);
  const response = await postBootstrap({
    headers: { cookie: `csrf-token=csrf-1; baci-cart-${MERCHANT_ID}=${old}` },
  });
  expect(response.status).toBe(201);
  expect(response.headers.get('set-cookie')).toContain(
    `baci-cart-${MERCHANT_ID}=cp1.`
  );
  const cookieProof = cookieValue(
    response.headers.get('set-cookie'),
    `baci-cart-${MERCHANT_ID}`
  );
  expect(
    verifyCartSessionProof(cookieProof ?? '', {
      secret: TEST_SECRET,
      environment: 'test',
    })
  ).toMatchObject({ ok: true, session: { cartId: null } });
});
