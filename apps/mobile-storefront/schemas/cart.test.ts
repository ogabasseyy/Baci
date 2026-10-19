import { nativeCartReplySchema, nativeCartSnapshotSchema } from './cart';

const id = '11111111-1111-4111-8111-111111111111';
const line = {
  id: 'line',
  item: { productId: id },
  quantity: 1,
  unitPriceMinor: 0,
  lineTotalMinor: 0,
};
const cart = {
  cartId: id,
  merchantId: id,
  state: 'active',
  version: 1,
  currency: 'NGN',
  subtotalMinor: 0,
  totalMinor: 0,
  estimatedTotals: false,
  expiresAt: '2099-01-01T00:00:00Z',
  lines: [line],
};
it('accepts valid snapshots and the twenty-line boundary', () => {
  expect(nativeCartSnapshotSchema.safeParse(cart).success).toBe(true);
  expect(
    nativeCartSnapshotSchema.safeParse({
      ...cart,
      lines: Array.from({ length: 20 }, () => line),
    }).success
  ).toBe(true);
});
it.each([
  { cartId: 'bad' },
  { merchantId: 'bad' },
  { currency: 'ngn' },
  { version: 0 },
  { totalMinor: -1 },
  { lines: Array.from({ length: 21 }, () => line) },
  { lines: [{ ...line, quantity: 11 }] },
  { lines: [{ ...line, item: { productId: id, condition: 'broken' } }] },
])('rejects invalid cart boundaries %j', (change) => {
  expect(
    nativeCartSnapshotSchema.safeParse({ ...cart, ...change }).success
  ).toBe(false);
});
it('accepts bootstrap, cart and error reply shapes', () => {
  for (const reply of [
    { proof: 'cp1.payload.signature' },
    { cart },
    { cart: null, code: 'not_found', error: 'Unavailable' },
  ])
    expect(nativeCartReplySchema.safeParse(reply).success).toBe(true);
});
it.each([
  { proof: 'secret' },
  { proof: `cp1.${'a'.repeat(8192)}.sig` },
  { cart: { ...cart, currency: 'x' } },
  { choice: 'invalid' },
  { linkedUserId: 'bad' },
])('rejects malformed replies %j', (reply) => {
  expect(nativeCartReplySchema.safeParse(reply).success).toBe(false);
});
