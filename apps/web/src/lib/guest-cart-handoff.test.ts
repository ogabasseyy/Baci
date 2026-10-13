import { expect, it } from 'vitest';
import { parseGuestCartHandoff } from './guest-cart-handoff';

const line = {
  product_id: '11111111-1111-4111-8111-111111111111',
  quantity: 3,
};
it('retains per-product quantities without accepting client prices', () => {
  expect(
    parseGuestCartHandoff(JSON.stringify([{ ...line, price: 1 }]))
  ).toEqual([line]);
});
it('rejects malformed, duplicate, oversized, fractional and excessive handoffs', () => {
  for (const raw of [
    'bad',
    JSON.stringify([line, line]),
    'x'.repeat(4001),
    JSON.stringify([{ ...line, quantity: 1.5 }]),
    JSON.stringify([{ ...line, quantity: 11 }]),
  ])
    expect(parseGuestCartHandoff(raw)).toBeNull();
});
