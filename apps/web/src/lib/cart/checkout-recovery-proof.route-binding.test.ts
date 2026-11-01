import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSharedCartOrderAuthority,
  resolveSharedCartOrderAuthority,
} from './order-route-binding';
import { issueCartSessionProof, verifyCartSessionProof } from './session-proof';

const merchantId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const grantId = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const otherUser = '66666666-6666-4666-8666-666666666666';
const secret = 'test-cart-checkout-recovery-secret-long-enough';
const environment = 'test-recovery';
const binding = {
  cart_id: cartId,
  cart_version: 1,
  checkout_generation: 1,
  checkout_session_id: sessionId,
};

function requestFor(subject: string | null = userId) {
  const proof = issueCartSessionProof(
    {
      merchantId,
      cartId,
      grantId,
      principalId: 'shopper-one',
      scope: 'session',
      grantExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    },
    {
      secret,
      environment,
      audience: `baci:checkout-recovery:${sessionId}:${subject ?? 'guest'}`,
    }
  );
  return {
    proof,
    request: new Request('https://store.example/api/orders', {
      headers: { cookie: `baci-checkout-recovery-${merchantId}=${proof}` },
    }),
  };
}

describe('bound UBA checkout recovery authority', () => {
  beforeEach(() => {
    vi.stubEnv('CART_SESSION_SECRET', secret);
    vi.stubEnv('CART_PROOF_ENVIRONMENT', environment);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('accepts the prepared shopper and session while rejecting another user, cart, session or payment method', () => {
    const { request, proof } = requestFor();
    const recovery = {
      userId,
      paymentMethod: 'uba_redvault' as const,
      requireRecoveryProof: true,
    };
    expect(
      getSharedCartOrderAuthority(request, binding, merchantId, { recovery })
    ).toEqual({ ok: true, principalId: 'shopper-one' });
    for (const result of [
      getSharedCartOrderAuthority(request, binding, merchantId, {
        recovery: { ...recovery, userId: otherUser },
      }),
      getSharedCartOrderAuthority(request, binding, merchantId, {
        recovery: { ...recovery, userId: null },
      }),
      getSharedCartOrderAuthority(
        request,
        { ...binding, cart_id: grantId },
        merchantId,
        { recovery }
      ),
      getSharedCartOrderAuthority(
        request,
        { ...binding, checkout_session_id: grantId },
        merchantId,
        { recovery }
      ),
      getSharedCartOrderAuthority(request, binding, grantId, { recovery }),
      getSharedCartOrderAuthority(request, binding, merchantId, {
        recovery: { ...recovery, paymentMethod: 'paystack' },
      }),
    ])
      expect(result.ok).toBe(false);
    expect(verifyCartSessionProof(proof, { secret, environment }).ok).toBe(
      false
    );
  });

  it('allows a guest recovery only while the current checkout is still a guest', () => {
    const { request } = requestFor(null);
    expect(
      getSharedCartOrderAuthority(request, binding, merchantId, {
        recovery: {
          userId: null,
          paymentMethod: 'uba_redvault',
          requireRecoveryProof: true,
        },
      })
    ).toEqual({ ok: true, principalId: 'shopper-one' });
    expect(
      getSharedCartOrderAuthority(request, binding, merchantId, {
        recovery: {
          userId,
          paymentMethod: 'uba_redvault',
          requireRecoveryProof: true,
        },
      }).ok
    ).toBe(false);
  });

  it('preserves recovery identity through the orders-route authority resolver', async () => {
    const { request } = requestFor();
    expect(
      await resolveSharedCartOrderAuthority(
        request,
        binding,
        merchantId,
        undefined,
        { userId, paymentMethod: 'uba_redvault', requireRecoveryProof: true }
      )
    ).toEqual({ ok: true, principalId: 'shopper-one' });
  });

  it('does not accept the recovery cookie for an ordinary order request', () => {
    const { request } = requestFor();
    expect(
      getSharedCartOrderAuthority(request, binding, merchantId, {
        recovery: { userId, paymentMethod: 'uba_redvault' },
      }).ok
    ).toBe(false);
  });

  it('does not fall back to a normal cart proof for an explicit recovery under a different user', () => {
    const { request: recoveryRequest } = requestFor(null);
    const normalProof = issueCartSessionProof(
      {
        merchantId,
        cartId,
        grantId,
        principalId: 'shopper-one',
        scope: 'session',
      },
      { secret, environment }
    );
    const request = new Request('https://store.example/api/orders', {
      headers: {
        cookie: `${recoveryRequest.headers.get('cookie')}; baci-cart-${merchantId}=${normalProof}`,
      },
    });
    expect(
      getSharedCartOrderAuthority(request, binding, merchantId, {
        recovery: {
          userId,
          paymentMethod: 'uba_redvault',
          requireRecoveryProof: true,
        },
      }).ok
    ).toBe(false);
  });

  it('does not let a recovery cookie or explicit recovery request fall through to an unbound order', () => {
    const { request } = requestFor();
    expect(getSharedCartOrderAuthority(request, undefined, merchantId).ok).toBe(
      false
    );
    expect(
      getSharedCartOrderAuthority(request, undefined, merchantId, {
        recovery: {
          userId,
          paymentMethod: 'uba_redvault',
          requireRecoveryProof: true,
        },
      }).ok
    ).toBe(false);
    expect(
      getSharedCartOrderAuthority(request, undefined, merchantId, {
        sharedCartEnrolled: false,
      })
    ).toEqual({ ok: true, principalId: null });
  });

  it('keeps an explicit unbound recovery request denied when shared cart is disabled', async () => {
    const { request } = requestFor();
    const result = await resolveSharedCartOrderAuthority(
      request,
      undefined,
      merchantId,
      async () => false,
      {
        userId,
        paymentMethod: 'uba_redvault',
        requireRecoveryProof: true,
      }
    );

    expect(result.ok).toBe(false);
  });
});
