import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolveCheckoutReconciliationAuthority } from './checkout-reconciliation-proof';
import { checkoutRecoveryAudience } from './checkout-recovery-proof';
import { issueCartSessionProof, verifyCartSessionProof } from './session-proof';

const merchantId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const grantId = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const secret = 'test-checkout-reconciliation-secret-long-enough';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T10:00:00Z'));
  vi.stubEnv('CART_SESSION_SECRET', secret);
  vi.stubEnv('CART_PROOF_ENVIRONMENT', 'test-reconciliation');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it('accepts an expired proof only for its bound checkout during reconciliation grace', () => {
  const proof = issueCartSessionProof(
    {
      merchantId,
      cartId,
      grantId,
      principalId: 'shopper-1',
      scope: 'session',
      grantExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    },
    {
      secret,
      environment: 'test-reconciliation',
      audience: checkoutRecoveryAudience(sessionId, userId),
    }
  );
  const request = new Request(
    'https://store.example/api/storefront/cart/checkout/reconcile',
    {
      headers: { cookie: `baci-checkout-reconcile-${merchantId}=${proof}` },
    }
  );
  vi.advanceTimersByTime(31 * 60_000);
  expect(
    verifyCartSessionProof(proof, {
      secret,
      environment: 'test-reconciliation',
      audience: checkoutRecoveryAudience(sessionId, userId),
    }).ok
  ).toBe(false);
  expect(
    resolveCheckoutReconciliationAuthority(request, {
      merchantId,
      cartId,
      sessionId,
      userId,
    })
  ).toMatchObject({ ok: true });
  expect(
    resolveCheckoutReconciliationAuthority(request, {
      merchantId,
      cartId,
      sessionId,
      userId: null,
    })
  ).toEqual({ ok: false });
  expect(
    resolveCheckoutReconciliationAuthority(request, {
      merchantId,
      cartId: grantId,
      sessionId,
      userId,
    })
  ).toEqual({ ok: false });
  vi.advanceTimersByTime(24 * 60 * 60_000);
  expect(
    resolveCheckoutReconciliationAuthority(request, {
      merchantId,
      cartId,
      sessionId,
      userId,
    })
  ).toEqual({ ok: false });
});
