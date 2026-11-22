import { expect, it, vi } from 'vitest';
import { createGuestCanonicalBridge } from './guest-cart-canonical-bridge';

const token = 'a'.repeat(64);
const state = {
  cartId: '11111111-1111-4111-8111-111111111111',
  version: 4,
  expiresAt: '2099-01-01T00:00:00Z',
  lines: [],
};

it('uses its startup storefront origin for empty carts in credential mode', async () => {
  vi.stubEnv('BACI_MCP_GUEST_CREDENTIAL_ENABLED', 'true');
  try {
    const bridge = createGuestCanonicalBridge(
      'https://shop.example/api/storefront/cart/legacy',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, state, continueUrl: null }))
      ),
      ['https://shop.example']
    );
    vi.stubEnv('MCP_CANONICAL_CART_BRIDGE_URL', 'https://ogabassey.com/api/storefront/cart/legacy');
    await expect(bridge?.read?.(token)).resolves.toMatchObject({
      cart_url: 'https://shop.example/cart',
    });
  } finally {
    vi.unstubAllEnvs();
  }
});
