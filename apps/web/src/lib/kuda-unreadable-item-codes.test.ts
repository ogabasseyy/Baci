import { describe, expect, it } from 'vitest';
import { collectUnreadableFixedItemCodes } from './kuda-unreadable-item-codes';

describe('collectUnreadableFixedItemCodes', () => {
  it.each([
    '',
    '  ',
    ' , ',
    '0',
    '0.00',
    0,
    -5,
    'abc',
    null,
    undefined,
  ])('collects a fixed item priced %j', (Amount) => {
    expect(
      collectUnreadableFixedItemCodes([
        { ItemCode: 'X', IsAmountFixed: true, Amount },
      ])
    ).toEqual(['X']);
  });

  it('ignores readable fixed prices and open amounts', () => {
    expect(
      collectUnreadableFixedItemCodes([
        { itemCode: 'ok', isFixedPrice: true, amount: '950,000' },
        { itemCode: 'open', isFixedPrice: false, amount: '' },
      ])
    ).toEqual([]);
  });

  it('reads nested items and every code field', () => {
    expect(
      collectUnreadableFixedItemCodes([
        {
          kudaIdentifier: 'group',
          isFixedPrice: false,
          amount: 0,
          billItems: [{ KudaIdentifier: 'child', IsFixedPrice: true }],
        },
      ])
    ).toEqual(['child']);
  });

  it('skips items without a code and children that are not a list', () => {
    expect(
      collectUnreadableFixedItemCodes([
        { IsAmountFixed: true, Amount: 0 },
        { ItemCode: 'g', IsAmountFixed: false, BillItems: {} },
      ])
    ).toEqual([]);
    expect(collectUnreadableFixedItemCodes({})).toEqual([]);
  });
});
