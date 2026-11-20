import { describe, expect, it } from 'vitest';
import { hasMalformedItemList } from './kuda-raw-malformed-items';

describe('hasMalformedItemList', () => {
  it.each([
    undefined,
    null,
    [],
    [{ BillItems: [] }],
    [{ billItems: [{}] }],
    [{ ItemCode: 'X', IsAmountFixed: true }],
    [{ isFixedPrice: false }],
  ])('accepts %j', (rawItems) => {
    expect(hasMalformedItemList(rawItems)).toBe(false);
  });

  it.each([
    {},
    'x',
    [{ BillItems: {} }],
    [{ billItems: [{ BillItems: 'x' }] }],
    [{ IsAmountFixed: true, Amount: 100000 }],
    [{ itemCode: ' ', isFixedPrice: true }],
    [{ billItems: [{ isFixedPrice: true }] }],
  ])('flags %j', (rawItems) => {
    expect(hasMalformedItemList(rawItems)).toBe(true);
  });
});
