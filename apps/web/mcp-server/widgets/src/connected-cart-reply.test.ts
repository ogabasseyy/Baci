import { expect, it } from 'vitest';
import { connectedCartReviewUrl, parseConnectedCartReply } from './connected-cart-reply';
const url =
  'https://ogabassey.com/cart#handoff=ch1.fixture.signature&hid=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const reply = {
  success: true,
  connection_bound: true,
  canonical_cart_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  version: 2,
  cart_url: url,
  items: [{ product_id: '11111111-1111-4111-8111-111111111111', quantity: 1 }],
};
it('accepts a signed-link connection reply without a model-held capability', () => {
  expect(parseConnectedCartReply(reply)).toMatchObject({ version: 2, items: reply.items, url });
  expect(
    connectedCartReviewUrl('https://evil.example/cart#handoff=ch1.fixture.signature'),
  ).toBeNull();
});
it.each([
  { version: 0 },
  { connection_bound: false },
  { items: [...reply.items, ...reply.items] },
  { canonical_cart_id: 'bad' },
  { cart_url: 'https://ogabassey.com/cart' },
  { cart_url: 'https://evil.example/cart' },
])('rejects malformed or uncorrelated connected reply %j', (patch) => {
  expect(parseConnectedCartReply({ ...reply, ...patch })).toBeNull();
});
