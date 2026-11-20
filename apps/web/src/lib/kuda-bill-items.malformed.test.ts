import { describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({ logger: { warn: vi.fn() } }));

import { mapKudaBillItems } from './kuda-bill-items';
import { collectRawFixedPricesKobo } from './kuda-raw-fixed-prices';

describe('bugfix: a blank fixed price was listed at ₦0', () => {
  it.each(['', '   ', ' , '])('drops a fixed item priced %j', (amount) => {
    const items = mapKudaBillItems([
      { itemCode: 'blank', itemName: 'Blank', amount, isFixedPrice: true },
      { itemCode: 'ok', itemName: 'Ok', amount: 100000, isFixedPrice: true },
    ]);

    expect(items?.map((item) => item.itemCode)).toEqual(['ok']);
  });

  it('keeps an open-amount item with a blank price at zero', () => {
    const [item] =
      mapKudaBillItems([
        { itemCode: 'open', itemName: 'Open', amount: '', isFixedPrice: false },
      ]) ?? [];

    expect(item?.amount).toBe(0);
  });
});

describe('bugfix: children that are not a list aborted the whole mapping', () => {
  it('drops the container and keeps its siblings', () => {
    const items = mapKudaBillItems([
      {
        itemCode: 'group',
        itemName: 'Group',
        amount: 0,
        isFixedPrice: false,
        BillItems: {},
      },
      { itemCode: 'ok', itemName: 'Ok', amount: 100000, isFixedPrice: true },
    ]);

    expect(items?.map((item) => item.itemCode)).toEqual(['ok']);
  });

  it('returns undefined for a list that is not an array', () => {
    expect(mapKudaBillItems({})).toBeUndefined();
  });

  it('skips non-list children when collecting raw prices', () => {
    expect(
      collectRawFixedPricesKobo([
        { Amount: 950000, IsAmountFixed: true, BillItems: {} },
      ])
    ).toEqual([950000]);
  });
});

describe('bugfix: a fixed price of zero was listed at ₦0', () => {
  it.each([0, '0', '0.00', -500])('drops a fixed item priced %j', (amount) => {
    const items = mapKudaBillItems([
      { itemCode: 'zero', itemName: 'Zero', amount, isFixedPrice: true },
      { itemCode: 'ok', itemName: 'Ok', amount: 100000, isFixedPrice: true },
    ]);

    expect(items?.map((item) => item.itemCode)).toEqual(['ok']);
  });

  it('keeps an open-amount item at zero', () => {
    const [item] =
      mapKudaBillItems([
        { itemCode: 'open', itemName: 'Open', amount: 0, isFixedPrice: false },
      ]) ?? [];

    expect(item?.amount).toBe(0);
  });
});
