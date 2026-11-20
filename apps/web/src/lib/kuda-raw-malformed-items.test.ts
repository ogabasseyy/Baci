import { describe, expect, it } from 'vitest';
import { hasMalformedItemList } from './kuda-raw-malformed-items';

describe('hasMalformedItemList', () => {
  it.each([
    undefined,
    null,
    [],
    [{ BillItems: [] }],
    [{ billItems: [{}] }],
  ])('accepts %j', (rawItems) => {
    expect(hasMalformedItemList(rawItems)).toBe(false);
  });

  it.each([
    {},
    'x',
    [{ BillItems: {} }],
    [{ billItems: [{ BillItems: 'x' }] }],
  ])('flags %j', (rawItems) => {
    expect(hasMalformedItemList(rawItems)).toBe(true);
  });
});
