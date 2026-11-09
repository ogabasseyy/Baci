import { describe, expect, it, vi } from 'vitest';
import { prepareCartCheckout } from './checkout-transition';
import type { CartPrincipal } from './principal';

const CART_ID = '22222222-2222-4222-8222-222222222222';
const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';

describe('prepareCartCheckout database clock contract', () => {
  it('fails closed when the RPC omits the database clock', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          code: null,
          grantExpiresAt: '2099-01-03T00:30:00.000Z',
          ok: true,
          replayed: false,
          sessionExpiresAt: '2099-01-01T00:30:00.000Z',
          sessionReused: false,
          snapshot: {
            cartId: CART_ID,
            cartVersion: 3,
            checkoutSessionId: SESSION_ID,
            currency: 'NGN',
            estimates: {
              currency: 'NGN',
              lineCount: 0,
              subtotalMinor: 0,
              unavailableCount: 0,
            },
            generation: 1,
            lines: [],
            merchantId: MERCHANT_ID,
          },
        },
        error: null,
      }),
    };
    const principal: CartPrincipal = {
      allowedOperations: ['add', 'set_quantity', 'remove', 'clear'],
      cartId: CART_ID,
      expiresAt: '2026-10-13T04:00:00Z',
      grantId: '55555555-5555-4555-8555-555555555555',
      merchantId: MERCHANT_ID,
      principalId: 'guest-a1',
      scope: 'session',
    };

    const result = await prepareCartCheckout(
      { client: client as never, principal },
      { cartId: CART_ID, expectedVersion: 3, operationId: 'prep-op-1' }
    );

    expect(result).toEqual({
      code: 'temporarily_unavailable',
      currentVersion: null,
      ok: false,
    });
  });
});
