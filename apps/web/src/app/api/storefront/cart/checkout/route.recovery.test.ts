import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { checkoutReconciliationCookieName } from '@/lib/cart/checkout-reconciliation-proof';
import {
  checkoutRecoveryAudience,
  checkoutRecoveryCookieName,
} from '@/lib/cart/checkout-recovery-proof';
import { verifyCartSessionProof } from '@/lib/cart/session-proof';
import { POST } from './route';

const merchantId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const grantId = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const secret = 'test-cart-checkout-recovery-secret-long-enough';

const mocks = vi.hoisted(() => ({
  user: { id: '55555555-5555-4555-8555-555555555555' } as { id: string } | null,
  authError: null as string | null,
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(async () => ({
    user: mocks.user,
    error: mocks.authError,
    supabase: null,
  })),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
}));
vi.mock('@/lib/cart/request-context', () => ({
  resolveCartRequestContext: vi.fn(async () => ({
    ok: true,
    merchant: { id: '11111111-1111-4111-8111-111111111111', slug: 'store' },
    principal: {
      merchantId: '11111111-1111-4111-8111-111111111111',
      cartId: '22222222-2222-4222-8222-222222222222',
      grantId: '33333333-3333-4333-8333-333333333333',
      principalId: 'shopper-one',
      scope: 'session',
      allowedOperations: [],
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    },
  })),
  readCartJsonBody: vi.fn(async (request: Request) => ({
    ok: true,
    body: await request.json(),
  })),
  createAnonMerchantFeatureLookup: vi.fn(() => vi.fn()),
  checkCartQuota: vi.fn(async () => ({ allowed: true })),
  requestUsesDeviceProof: vi.fn(() => false),
}));
vi.mock('@/lib/cart/checkout-transition', () => ({
  prepareCartCheckout: vi.fn(async () => ({
    ok: true,
    snapshot: {
      cartId: '22222222-2222-4222-8222-222222222222',
      merchantId: '11111111-1111-4111-8111-111111111111',
      checkoutSessionId: '44444444-4444-4444-8444-444444444444',
    },
    sessionExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    grantExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    replayed: false,
    sessionReused: false,
  })),
}));
vi.mock('@/lib/cart/grant-operations', () => ({
  upgradeLegacySessionPrincipal: vi.fn(async (_client, principal) => principal),
}));
vi.mock('@/lib/cart/scoped-client', () => ({
  createCartScopedClient: vi.fn(() => ({})),
}));
vi.mock('@/lib/supabase/anon', () => ({ createAnonClient: vi.fn(() => ({})) }));
vi.mock('@/lib/slug-alias-cache', () => ({ getCurrentSlugForAlias: vi.fn() }));

beforeEach(() => {
  vi.stubEnv('CART_SESSION_SECRET', secret);
  vi.stubEnv('CART_PROOF_ENVIRONMENT', 'test-recovery');
  mocks.user = { id: userId };
  mocks.authError = null;
});
afterEach(() => vi.unstubAllEnvs());

async function prepare(recoveryForRedvault: boolean) {
  return POST(
    new NextRequest('https://store.example/api/storefront/cart/checkout', {
      method: 'POST',
      body: JSON.stringify({
        cartId,
        expectedVersion: 1,
        operationId: 'op-1',
        recoveryForRedvault,
      }),
    })
  );
}

it('issues a short-lived HttpOnly proof scoped to the verified shopper and prepared checkout', async () => {
  const response = await prepare(true);
  expect(response.status).toBe(200);
  const cookies = response.headers.get('set-cookie') ?? '';
  const name = checkoutRecoveryCookieName(merchantId);
  const match = cookies.match(new RegExp(`${name}=([^;,]+)`));
  expect(match).not.toBeNull();
  expect(cookies).toContain('HttpOnly');
  const reconciliationCookie = response.cookies.get(
    checkoutReconciliationCookieName(merchantId)
  );
  expect(reconciliationCookie?.value).toBe(match?.[1]);
  expect(reconciliationCookie?.httpOnly).toBe(true);
  expect(reconciliationCookie?.maxAge).toBeGreaterThan(24 * 60 * 60);
  const proof = decodeURIComponent(match?.[1] ?? '');
  const verified = verifyCartSessionProof(proof, {
    secret,
    environment: 'test-recovery',
    audience: checkoutRecoveryAudience(sessionId, userId),
  });
  expect(verified.ok).toBe(true);
  if (!verified.ok) throw new Error('missing recovery authority');
  expect(verified.session).toMatchObject({
    merchantId,
    cartId,
    grantId,
    principalId: 'shopper-one',
  });
  expect(
    Date.parse(verified.session.expiresAt) - Date.now()
  ).toBeLessThanOrEqual(30 * 60_000);
  expect((await response.json()).proof).toBeUndefined();
});

it('does not issue a recovery proof for ordinary checkout or an indeterminate auth failure', async () => {
  expect((await prepare(false)).headers.get('set-cookie') ?? '').not.toContain(
    checkoutRecoveryCookieName(merchantId)
  );
  expect((await prepare(false)).headers.get('set-cookie') ?? '').not.toContain(
    checkoutReconciliationCookieName(merchantId)
  );
  mocks.user = null;
  mocks.authError = 'Authentication failed';
  const response = await prepare(true);
  expect(response.status).toBe(503);
  expect(response.headers.get('set-cookie') ?? '').not.toContain(
    checkoutRecoveryCookieName(merchantId)
  );
});
