import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartPrincipal } from '@/lib/cart/principal';
import {
  __resetCartQuotaStoreForTesting,
  checkCartQuota,
} from '@/lib/cart/request-context';
import { issueCartSessionProof } from '@/lib/cart/session-proof';
import { getTrustedClientIdentifier } from '@/lib/rate-limit';
import { GET, POST } from './route';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const CART_ID = '22222222-2222-4222-8222-222222222222';
const GRANT_ID = '33333333-3333-4333-8333-333333333333';
const TEST_SECRET = 'test-cart-session-secret-min-32-chars!!';

const mocks = vi.hoisted(() => ({
  alias: null as string | null,
  capturedPrincipal: null as CartPrincipal | null,
  cartError: null as unknown,
  cartPayload: null as unknown,
  cartRpcCalls: [] as { args: unknown; name: string }[],
  merchantError: null as unknown,
  merchantRows: [] as unknown[],
  handoffMerchantId: null as string | null,
  locatorArgs: null as unknown,
  previewCalls: 0,
  previewError: null as unknown,
  previewPayload: null as unknown,
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
    rpc: vi.fn(async (name: string, args: unknown) => {
      if (name === 'commerce_cart_preview_handoff') {
        mocks.previewCalls += 1;
        return { data: mocks.previewPayload, error: mocks.previewError };
      }
      if (name === 'commerce_cart_handoff_merchant') {
        mocks.locatorArgs = args;
        return { data: mocks.handoffMerchantId, error: null };
      }
      return { data: mocks.merchantRows, error: mocks.merchantError };
    }),
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

function rawState(overrides: Record<string, unknown> = {}) {
  return {
    cartId: CART_ID,
    checkoutSessionId: null,
    currency: 'NGN',
    expiresAt: '2026-10-19T04:00:00Z',
    lines: [],
    merchantId: MERCHANT_ID,
    replayed: false,
    state: 'active',
    version: 3,
    ...overrides,
  };
}

function _sessionProof(): string {
  return issueCartSessionProof(
    {
      cartId: CART_ID,
      grantId: GRANT_ID,
      merchantId: MERCHANT_ID,
      principalId: 'guest-origin',
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
      merchantId: MERCHANT_ID,
      principalId: 'guest-new',
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
  mocks.handoffMerchantId = null;
  mocks.locatorArgs = null;
  mocks.previewCalls = 0;
  mocks.previewError = null;
  mocks.previewPayload = null;
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

const HANDOFF_URL = 'https://ogabassey.usebaci.com/api/storefront/cart/handoff';

function _postIssue(init: {
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
    'x-merchant-slug': 'ogabassey',
  };
  if (init.headers?.cookie && !init.noCsrf) {
    headers.cookie = `csrf-token=csrf-1; ${init.headers.cookie}`;
  }
  return POST(
    new NextRequest(HANDOFF_URL, {
      body: init.rawBody ?? JSON.stringify(init.body ?? {}),
      headers,
      method: 'POST',
    })
  );
}

describe('GET /api/storefront/cart/handoff', () => {
  function getPreview(handoffId: string | null) {
    const url =
      handoffId === null
        ? HANDOFF_URL
        : `${HANDOFF_URL}?handoff_id=${handoffId}`;
    return GET(
      new NextRequest(url, {
        headers: { 'x-handoff-token': 'ch1.fixture.token' },
        method: 'GET',
      })
    );
  }

  it('previews a pending grant without consuming or authenticating', async () => {
    mocks.handoffMerchantId = MERCHANT_ID;
    mocks.previewPayload = {
      code: null,
      expiresAt: '2026-10-12T06:05:00.000Z',
      merchant: { id: MERCHANT_ID, slug: 'ogabassey' },
      ok: true,
      snapshot: rawState(),
      status: 'pending',
    };

    const response = await getPreview('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const payload = await response.json();
    expect(payload.status).toBe('pending');
    expect(payload.snapshot.version).toBe(3);
    expect(payload.merchant).toEqual({ id: MERCHANT_ID, slug: 'ogabassey' });
    expect(mocks.capturedPrincipal).toBeNull();
    expect(mocks.cartRpcCalls).toHaveLength(0);
    // The merchant locator is token-gated: it receives the raw pairing
    // token (hashed inside the RPC), never the id alone.
    expect(mocks.locatorArgs).toEqual({
      p_handoff_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      p_token: 'ch1.fixture.token',
    });
  });

  it('reports consumed and expired links as statuses, unknown as 404', async () => {
    mocks.handoffMerchantId = MERCHANT_ID;
    for (const status of ['consumed', 'expired'] as const) {
      mocks.previewPayload = {
        code: null,
        expiresAt: '2026-10-12T06:05:00.000Z',
        ok: true,
        status,
      };
      const response = await getPreview('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      expect(response.status).toBe(200);
      expect((await response.json()).status).toBe(status);
    }

    mocks.previewPayload = { code: 'not_found', ok: false };
    const missing = await getPreview('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe('not_found');
  });

  it('fails closed without the preview RPC when the locator resolves nothing', async () => {
    mocks.handoffMerchantId = null;
    mocks.previewPayload = {
      code: null,
      expiresAt: '2026-10-12T06:05:00.000Z',
      merchant: { id: MERCHANT_ID, slug: 'ogabassey' },
      ok: true,
      snapshot: rawState(),
      status: 'pending',
    };
    const previewCallsBefore = mocks.previewCalls;

    const response = await getPreview('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('not_found');
    expect(mocks.previewCalls).toBe(previewCallsBefore);
  });

  it('rejects missing and malformed preview ids', async () => {
    expect((await getPreview(null)).status).toBe(400);
    expect((await getPreview('not-a-uuid')).status).toBe(400);
  });

  it('rejects an overlong pairing token before any database call', async () => {
    const previewCallsBefore = mocks.previewCalls;
    const response = await GET(
      new NextRequest(
        `${HANDOFF_URL}?handoff_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
        {
          headers: { 'x-handoff-token': `ch1.${'x'.repeat(600)}` },
          method: 'GET',
        }
      )
    );
    expect(response.status).toBe(404);
    expect(mocks.previewCalls).toBe(previewCallsBefore);
  });

  it('applies the per-client quota before running the preview RPC', async () => {
    mocks.previewPayload = {
      code: null,
      expiresAt: '2026-10-12T06:05:00.000Z',
      merchant: { id: MERCHANT_ID, slug: 'ogabassey' },
      ok: true,
      snapshot: rawState(),
      status: 'pending',
    };
    const probe = new NextRequest(
      `${HANDOFF_URL}?handoff_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      { method: 'GET' }
    );
    const subject = getTrustedClientIdentifier(probe);
    for (let index = 0; index < 120; index += 1) {
      await checkCartQuota({
        merchantId: 'handoff-preview',
        operation: 'handoff_preview',
        subject,
      });
    }
    const previewCallsBefore = mocks.previewCalls;

    // A rotated handoff id must not mint a fresh per-client bucket.
    const response = await getPreview('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('quota_exceeded');
    expect(mocks.previewCalls).toBe(previewCallsBefore);
  });

  it('applies the merchant quota before the preview RPC assembles anything', async () => {
    mocks.handoffMerchantId = MERCHANT_ID;
    mocks.previewPayload = {
      code: null,
      expiresAt: '2026-10-12T06:05:00.000Z',
      merchant: { id: MERCHANT_ID, slug: 'ogabassey' },
      ok: true,
      snapshot: rawState(),
      status: 'pending',
    };
    const probe = new NextRequest(
      `${HANDOFF_URL}?handoff_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      { method: 'GET' }
    );
    const subject = getTrustedClientIdentifier(probe);
    for (let index = 0; index < 120; index += 1) {
      await checkCartQuota({
        merchantId: MERCHANT_ID,
        operation: 'handoff_preview',
        subject,
      });
    }
    const previewCallsBefore = mocks.previewCalls;

    // A rotated handoff id must not mint a fresh per-client bucket.
    const response = await getPreview('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('quota_exceeded');
    // The expensive preview RPC never ran for this attempt.
    expect(mocks.previewCalls).toBe(previewCallsBefore);
  });
});
