import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCartQuotaStoreForTesting } from '@/lib/cart/request-context';
import {
  CART_BOOTSTRAP_PROOF_TTL_SECONDS,
  verifyCartSessionProof,
} from '@/lib/cart/session-proof';
import { POST } from './route';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const TEST_SECRET = 'test-cart-session-secret-min-32-chars!!';

const mocks = vi.hoisted(() => ({
  alias: null as string | null,
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
  __resetCartQuotaStoreForTesting();
  mocks.alias = null;
  mocks.merchantError = null;
  mocks.merchantRows = [merchantRow()];
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
    expect(typeof payload.proof).toBe('string');
    expect(payload.proof.startsWith('cp1.')).toBe(true);

    const verified = verifyCartSessionProof(payload.proof, {
      environment: 'test',
      secret: TEST_SECRET,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.session.merchantId).toBe(MERCHANT_ID);
      expect(verified.session.cartId).toBeNull();
      expect(verified.session.grantId).toBeNull();
    }

    const cookieProof = cookieValue(
      response.headers.get('set-cookie'),
      'baci-cart-ogabassey'
    );
    expect(cookieProof).toBe(payload.proof);
  });

  it('serves native clients that carry no cookies', async () => {
    const response = await postBootstrap({
      headers: { authorization: 'Bearer native-device-token' },
      noCsrf: true,
      url: 'https://usebaci.com/api/storefront/cart/bootstrap?merchantSlug=ogabassey',
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.proof.startsWith('cp1.')).toBe(true);
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
