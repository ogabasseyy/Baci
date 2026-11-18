import { describe, expect, it, vi } from 'vitest';
import {
  CART_ID,
  cartCookie,
  getCart,
  mocks,
  rawLine,
  rawState,
  sessionProof,
} from './route.test-support';

vi.mock('@/lib/cart/grant-operations', () => ({
  upgradeLegacySessionPrincipal: vi.fn(async () => {
    throw new Error('Could not verify the cart grant operations');
  }),
}));

describe('bugfix: legacy proof upgrade failure turned a valid read into a 503', () => {
  it('still returns the cart snapshot when the optional upgrade throws', async () => {
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      state: rawState({ lines: [rawLine()] }),
    };

    const response = await getCart({
      headers: { cookie: cartCookie(sessionProof()) },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect((await response.json()).cart.cartId).toBe(CART_ID);
  });
});
