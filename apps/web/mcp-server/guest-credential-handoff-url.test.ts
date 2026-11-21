import { afterEach, expect, it, vi } from 'vitest';
import { guestCredentialHandoffUrl } from './guest-credential-handoff-url';

const camera = '22222222-2222-4222-8222-222222222222';
const cartId = '33333333-3333-4333-8333-333333333333';
const handoffUrl =
  'https://ogabassey.com/cart#handoff=ch1.fixture.signature&hid=44444444-4444-4444-8444-444444444444';

afterEach(() => vi.unstubAllEnvs());

it('only returns exact signed handoff URLs on an allowed storefront origin', () => {
  vi.stubEnv(
    'MCP_CANONICAL_CART_BRIDGE_ALLOWED_ORIGINS',
    'https://ogabassey.com,https://shop.example'
  );
  const cart = {
    cart_token: '0'.repeat(64),
    canonical_cart_id: cartId,
    items: [{ product_id: camera, quantity: 1 }],
    version: 2,
  };
  const configuredUrl = handoffUrl.replace('ogabassey.com', 'shop.example');
  vi.stubEnv(
    'MCP_CANONICAL_CART_BRIDGE_URL',
    'https://shop.example/api/storefront/cart/legacy'
  );
  expect(guestCredentialHandoffUrl({ ...cart, items: [] })).toBe(
    'https://shop.example/cart'
  );
  expect(guestCredentialHandoffUrl({ ...cart, cart_url: configuredUrl })).toBe(
    configuredUrl
  );
  for (const cart_url of [
    handoffUrl.replace('ogabassey.com', 'outside.example'),
    handoffUrl.replace('ch1.fixture.signature', 'malformed'),
    handoffUrl.replace('44444444-4444-4444-8444-444444444444', 'malformed'),
    handoffUrl + '&handoff=ch1.duplicate.signature',
    handoffUrl + ' ',
  ]) {
    expect(() => guestCredentialHandoffUrl({ ...cart, cart_url })).toThrow();
  }
});
