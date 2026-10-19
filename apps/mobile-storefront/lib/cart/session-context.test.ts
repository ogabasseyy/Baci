import { readNativeCartContext } from './session-context';

const merchant = '11111111-1111-4111-8111-111111111111';
const proof = (changes: Record<string, unknown> = {}) =>
  `cp1.${Buffer.from(JSON.stringify({ merchantId: merchant, principalId: 'guest-1', scope: 'bootstrap', cartId: null, exp: 5000, ...changes })).toString('base64url')}.signature`;
it('uses proof metadata only to fence local replay to the same merchant and principal', () => {
  expect(readNativeCartContext(proof(), merchant, 1000000)).toEqual({
    actor: 'guest-1',
    cartId: null,
  });
  expect(() =>
    readNativeCartContext(
      proof(),
      '22222222-2222-4222-8222-222222222222',
      1000000
    )
  ).toThrow();
  expect(() =>
    readNativeCartContext(proof({ exp: 999 }), merchant, 1000000)
  ).toThrow();
  expect(() =>
    readNativeCartContext('cp1.invalid.signature', merchant, 1000000)
  ).toThrow();
});
it('retains the actor through bootstrap promotion and proof renewal', () => {
  const cartId = '22222222-2222-4222-8222-222222222222';
  expect(
    readNativeCartContext(
      proof({ cartId, scope: 'session' }),
      merchant,
      1000000
    )
  ).toEqual({ actor: 'guest-1', cartId });
});
