import { describe, expect, it } from 'vitest';
import { hasMalformedItemList } from './kuda-raw-malformed-items';

// Each case is wrapped so it.each passes the whole list, not its spread items.
const readable: unknown[] = [
  undefined,
  null,
  [],
  [{ BillItems: [] }],
  [{ billItems: [{}] }],
  [{ ItemCode: 'X', IsAmountFixed: true }],
  [{ isFixedPrice: false }],
];

const malformed: unknown[] = [
  {},
  'x',
  [{ BillItems: {} }],
  [{ billItems: [{ BillItems: 'x' }] }],
  [{ IsAmountFixed: true, Amount: 100000 }],
  [{ itemCode: ' ', isFixedPrice: true }],
  [{ billItems: [{ isFixedPrice: true }] }],
  [{ ItemCode: 'A', IsAmountFixed: true }, null],
  [{ billItems: ['x'] }],
];

describe('hasMalformedItemList', () => {
  it.each(readable.map((rawItems) => [rawItems]))('accepts %j', (rawItems) => {
    expect(hasMalformedItemList(rawItems)).toBe(false);
  });

  it.each(malformed.map((rawItems) => [rawItems]))('flags %j', (rawItems) => {
    expect(hasMalformedItemList(rawItems)).toBe(true);
  });
});
