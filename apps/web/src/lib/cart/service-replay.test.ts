import { describe, expect, it, vi } from 'vitest';
import type { CartPrincipal } from './principal';
import { mutateCart } from './service';

const principal: CartPrincipal = {
  allowedOperations: ['clear'],
  cartId: '22222222-2222-4222-8222-222222222222',
  expiresAt: '2026-10-13T04:00:00Z',
  grantId: '33333333-3333-4333-8333-333333333333',
  merchantId: '11111111-1111-4111-8111-111111111111',
  principalId: 'guest-a1',
  scope: 'session',
};

describe('mutateCart replay metadata', () => {
  it('preserves the live RPC version beside the stored replay snapshot', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        code: null,
        currentVersion: 5,
        ok: true,
        replayed: true,
        state: {
          cartId: principal.cartId,
          checkoutSessionId: null,
          currency: 'NGN',
          expiresAt: '2026-10-14T04:00:00Z',
          lines: [],
          merchantId: principal.merchantId,
          replayed: true,
          state: 'active',
          version: 2,
        },
      },
      error: null,
    });

    const result = await mutateCart(
      { client: { rpc } as never, principal },
      {
        command: { type: 'clear' },
        expectedVersion: 1,
        operationId: 'op-1',
      }
    );

    expect(result).toMatchObject({
      cart: { version: 2 },
      currentVersion: 5,
      ok: true,
      replayed: true,
    });
  });
});
