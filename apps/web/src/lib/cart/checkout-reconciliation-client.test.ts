import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createCheckoutReconciliationClient } from './checkout-reconciliation-client';
import { resolveCheckoutReconciliationAuthority } from './checkout-reconciliation-proof';
import { checkoutRecoveryAudience } from './checkout-recovery-proof';
import { issueCartSessionProof } from './session-proof';

const createClientMock = vi.hoisted(() =>
  vi.fn(
    (
      _url: string,
      _key: string,
      _options: { global: { headers: { Authorization: string } } }
    ) => ({})
  )
);
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));

afterEach(() => vi.unstubAllEnvs());

it('mints a short-lived recovery-scoped capability bound to the verified shopper and attempt', () => {
  const now = new Date('2026-10-29T10:00:00Z');
  const merchantId = '11111111-1111-4111-8111-111111111111';
  const cartId = '22222222-2222-4222-8222-222222222222';
  const grantId = '33333333-3333-4333-8333-333333333333';
  const sessionId = '44444444-4444-4444-8444-444444444444';
  const userId = '55555555-5555-4555-8555-555555555555';
  const secret = 'test-cart-checkout-reconciliation-secret';
  vi.stubEnv('CART_SESSION_SECRET', secret);
  vi.stubEnv('CART_PROOF_ENVIRONMENT', 'test-reconciliation');
  vi.useFakeTimers();
  vi.setSystemTime(now);
  try {
    const proof = issueCartSessionProof(
      {
        merchantId,
        cartId,
        grantId,
        principalId: 'shopper-1',
        scope: 'session',
        grantExpiresAt: new Date(now.getTime() + 30_000).toISOString(),
      },
      {
        secret,
        now,
        environment: 'test-reconciliation',
        audience: checkoutRecoveryAudience(sessionId, userId),
      }
    );
    const request = new Request('https://store.example/reconcile', {
      headers: { cookie: `baci-checkout-reconcile-${merchantId}=${proof}` },
    });
    const resolved = resolveCheckoutReconciliationAuthority(request, {
      merchantId,
      cartId,
      sessionId,
      userId,
    });
    if (!resolved.ok) throw new Error('missing authority');
    createCheckoutReconciliationClient(
      resolved.authority,
      {
        generation: 3,
        cartVersion: 7,
        customerEmail: 'ada@example.test',
        idempotencyKey: 'attempt-key',
      },
      {
        now,
        anonKey: 'test-anon-key',
        supabaseUrl: 'https://test.supabase.co',
        signer: {
          type: 'legacy-secret',
          secret: 'test-scoped-jwt-secret-with-enough-length-001',
        },
      }
    );
    const token = createClientMock.mock.calls
      .at(-1)?.[2]
      .global.headers.Authorization.slice('Bearer '.length);
    const payload = JSON.parse(
      Buffer.from(token?.split('.')[1] ?? '', 'base64url').toString('utf8')
    );
    expect(payload).toMatchObject({
      role: 'commerce_cart_shopper',
      cart_scope: 'checkout_recovery',
      cart_merchant_id: merchantId,
      cart_id: cartId,
      cart_grant_id: grantId,
      cart_principal_id: 'shopper-1',
      cart_recovery_session_id: sessionId,
      cart_recovery_generation: 3,
      cart_recovery_version: 7,
      cart_recovery_user_id: userId,
      cart_recovery_email: 'ada@example.test',
      cart_recovery_key_hash: createHash('sha256')
        .update('attempt-key')
        .digest('hex'),
    });
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(60);
    expect(JSON.stringify(payload)).not.toContain('attempt-key');
  } finally {
    vi.useRealTimers();
  }
});
