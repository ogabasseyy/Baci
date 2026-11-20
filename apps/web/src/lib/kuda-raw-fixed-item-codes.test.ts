import { describe, expect, it } from 'vitest';
import { collectRawFixedItemCodes } from './kuda-raw-fixed-item-codes';

describe('collectRawFixedItemCodes', () => {
  it.each([
    950000,
    '950,000',
    '',
    0,
    'abc',
    null,
  ])('collects a fixed item whatever its price (%j)', (Amount) => {
    expect(
      collectRawFixedItemCodes([{ ItemCode: 'X', IsAmountFixed: true, Amount }])
    ).toEqual(['X']);
  });

  it('ignores open-amount items', () => {
    expect(
      collectRawFixedItemCodes([{ itemCode: 'open', isFixedPrice: false }])
    ).toEqual([]);
  });

  it('reads nested items and every code field', () => {
    expect(
      collectRawFixedItemCodes([
        {
          kudaIdentifier: 'group',
          isFixedPrice: false,
          billItems: [{ KudaIdentifier: 'child', IsFixedPrice: true }],
        },
      ])
    ).toEqual(['child']);
  });

  it('skips items without a code and children that are not a list', () => {
    expect(
      collectRawFixedItemCodes([
        { IsAmountFixed: true },
        { ItemCode: 'g', IsAmountFixed: false, BillItems: {} },
      ])
    ).toEqual([]);
    expect(collectRawFixedItemCodes({})).toEqual([]);
  });

  it.each([
    1,
    'true',
  ])('reads a truthy fixed flag (%j) like the mapper', (flag) => {
    expect(
      collectRawFixedItemCodes([{ ItemCode: 'X', IsAmountFixed: flag }])
    ).toEqual(['X']);
  });
});
