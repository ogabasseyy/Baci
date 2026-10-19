import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartPrincipal } from '@/lib/cart/principal';
import { __resetCartQuotaStoreForTesting } from '@/lib/cart/request-context';
import { issueCartSessionProof } from '@/lib/cart/session-proof';
import { POST } from './route';

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

function _rawState(overrides: Record<string, unknown> = {}) {
  return {
    cartId: CART_ID,
    checkoutSessionId: null,
    currency: 'NGN',
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    lines: [],
    merchantId: MERCHANT_ID,
    replayed: false,
    state: 'active',
    version: 3,
    ...overrides,
  };
}

function sessionProof(): string {
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

function bootstrapProof(): string {
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

function postIssue(init: {
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

describe('POST /api/storefront/cart/handoff', () => {
  it('issues a grant by hash and returns a fragment continuation URL', async () => {
    mocks.cartPayload = {
      code: null,
      handoff: {
        expiresAt: '2026-10-12T06:05:00.000Z',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      ok: true,
      replayed: false,
    };

    const response = await postIssue({
      body: { destination: { type: 'web' }, operationId: 'handoff-op-1' },
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
      },
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const payload = await response.json();
    expect(payload.handoffId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(payload.replayed).toBe(false);
    expect(payload.continueUrl).toMatch(
      /^https:\/\/ogabassey\.usebaci\.com\/cart#handoff=ch1\..*&hid=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa$/
    );
    expect(mocks.capturedPrincipal).toMatchObject({
      cartId: CART_ID,
      scope: 'session',
    });
    expect(mocks.cartRpcCalls).toHaveLength(1);
    expect(mocks.cartRpcCalls[0]?.name).toBe('commerce_cart_issue_handoff');
    const args = mocks.cartRpcCalls[0]?.args as Record<string, unknown>;
    expect(args.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain('ch1.');
  });

  it('forbids issue for proofs without a cart', async () => {
    const response = await postIssue({
      body: { destination: { type: 'web' }, operationId: 'handoff-op-1' },
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${bootstrapProof()}`,
      },
    });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('forbidden');
    expect(mocks.cartRpcCalls).toHaveLength(0);
  });

  it('rejects missing CSRF and malformed bodies', async () => {
    const csrf = await postIssue({
      body: { destination: { type: 'web' }, operationId: 'handoff-op-1' },
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
      },
      noCsrf: true,
    });
    expect(csrf.status).toBe(403);
    expect((await csrf.json()).code).toBe('forbidden');

    const malformed = await postIssue({
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
      },
      rawBody: '{"destination":',
    });
    expect(malformed.status).toBe(400);

    const unknown = await postIssue({
      body: { destination: { type: 'sms' }, operationId: 'handoff-op-1' },
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
      },
    });
    expect(unknown.status).toBe(400);
  });

  it('maps consumed grants without minting', async () => {
    mocks.cartPayload = {
      code: 'handoff_consumed',
      ok: false,
      replayed: false,
    };

    const response = await postIssue({
      body: { destination: { type: 'web' }, operationId: 'handoff-op-1' },
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
      },
    });

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('handoff_consumed');
  });

  it('fails closed without a provisioned secret', async () => {
    delete process.env.CART_SESSION_SECRET;

    const response = await postIssue({
      body: { destination: { type: 'web' }, operationId: 'handoff-op-1' },
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
      },
    });

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('temporarily_unavailable');
  });

  it('never logs pairing material on unexpected faults', async () => {
    mocks.cartError = new Error('boom ch1.fake-pairing-token');
    const spy = console.error as unknown as ReturnType<typeof vi.fn>;

    const response = await postIssue({
      body: { destination: { type: 'web' }, operationId: 'handoff-op-1' },
      headers: {
        cookie: `baci-cart-11111111-1111-4111-8111-111111111111=${sessionProof()}`,
      },
    });

    expect(response.status).toBe(503);
    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('ch1.');
    }
  });
});
