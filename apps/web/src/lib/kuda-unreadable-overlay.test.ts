import { describe, expect, it } from 'vitest';
import type { Biller } from './kuda';
import { overlayUnreadableCodes } from './kuda-unreadable-overlay';

const item = (itemCode: string, amount = 9500) => ({
  amount,
  isAmountFixed: true,
  itemCode,
  itemCurrencySymbol: 'NGN',
  itemFee: 0,
  itemName: itemCode,
});

const biller = (billerId: string, extra: Partial<Biller> = {}): Biller => ({
  billerId,
  billerName: billerId.toUpperCase(),
  billerType: 'Cable',
  categoryId: 'cable',
  categoryName: 'CableTv',
  ...extra,
});

describe('overlayUnreadableCodes', () => {
  it('removes freshly unreadable codes from the saved list and records them', () => {
    const saved = [biller('dstv', { billItems: [item('A'), item('B')] })];
    const fresh = [biller('dstv', { unreadableItemCodes: ['a'] })];

    const [corrected] = overlayUnreadableCodes(saved, fresh);

    expect(corrected?.billItems?.map((entry) => entry.itemCode)).toEqual(['B']);
    expect(corrected?.unreadableItemCodes).toEqual(['a']);
  });

  it('drops a group whose children were all marked unreadable', () => {
    const saved = [
      biller('dstv', {
        billItems: [
          { ...item('GROUP', 0), isAmountFixed: false, billItems: [item('A')] },
          item('B'),
        ],
      }),
    ];
    const fresh = [biller('dstv', { unreadableItemCodes: ['A'] })];

    expect(
      overlayUnreadableCodes(saved, fresh)[0]?.billItems?.map(
        (entry) => entry.itemCode
      )
    ).toEqual(['B']);
  });

  it('leaves other billers and an answer without unreadable codes alone', () => {
    const saved = [
      biller('dstv', { billItems: [item('A')] }),
      biller('gotv', { billItems: [item('G')] }),
    ];

    expect(overlayUnreadableCodes(saved, [biller('dstv')])).toBe(saved);
    expect(
      overlayUnreadableCodes(saved, [
        biller('dstv', { unreadableItemCodes: ['A'] }),
      ])[1]
    ).toBe(saved[1]);
  });

  it('matches a saved biller by name when Kuda changed its ID', () => {
    const saved = [biller('dstv', { billItems: [item('A'), item('B')] })];
    const fresh = [
      { ...biller('dstv-new'), billerName: 'DSTV', unreadableItemCodes: ['A'] },
    ];

    const corrected = overlayUnreadableCodes(saved, fresh);

    expect(corrected).toHaveLength(1);
    expect(corrected[0]?.billItems?.map((entry) => entry.itemCode)).toEqual([
      'B',
    ]);
  });

  it('adds a fresh biller the saved list lacks, with only its unreadable codes', () => {
    const saved = [biller('dstv', { billItems: [item('A')] })];
    const fresh = [
      biller('newco', { billItems: [item('X')], unreadableItemCodes: ['A'] }),
    ];

    const corrected = overlayUnreadableCodes(saved, fresh);

    expect(corrected[0]).toBe(saved[0]);
    expect(corrected[1]).toMatchObject({
      billerId: 'newco',
      unreadableItemCodes: ['A'],
    });
    expect(corrected[1]?.billItems).toBeUndefined();
  });
});
