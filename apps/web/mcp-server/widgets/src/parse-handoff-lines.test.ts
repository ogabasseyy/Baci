import { expect, it } from 'vitest';
import { parseHandoffLines } from './parse-handoff-lines';

const line = {
  product_id: '11111111-1111-4111-8111-111111111111',
  quantity: 3,
};

it('parses valid lines without accepting client prices', () => {
  expect(parseHandoffLines(JSON.stringify([{ ...line, price: 1 }]))).toEqual([
    line,
  ]);
});

it('rejects malformed, duplicate, oversized, fractional and excessive handoffs', () => {
  for (const raw of [
    'bad',
    JSON.stringify([line, line]),
    'x'.repeat(4001),
    JSON.stringify([{ ...line, quantity: 1.5 }]),
    JSON.stringify([{ ...line, quantity: 11 }]),
    JSON.stringify([{ ...line, product_id: 'not-a-uuid' }]),
    JSON.stringify([]),
  ])
    expect(parseHandoffLines(raw)).toBeNull();
});
