import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoggerWarn = vi.fn();
vi.mock('./logger', () => ({
  logger: { warn: (...args: unknown[]) => mockLoggerWarn(...args) },
}));

import { mapKudaBillItems } from './kuda-bill-items';

describe('mapKudaBillItems', () => {
  describe('bugfix: Kuda bill item prices were shown and charged 100x', () => {
    it('converts a fixed data bundle price from kobo to naira', () => {
      // Kuda lists MTN "1GB Monthly Plan" at 100000 kobo, which is ₦1,000.
      const [item] =
        mapKudaBillItems([
          {
            kudaIdentifier: 'KUD-DAT-MTN-1GB',
            name: '1GB Monthly Plan (30 Days)',
            amount: 100000,
            isFixedPrice: true,
          },
        ]) ?? [];

      expect(item?.amount).toBe(1000);
    });

    it('converts PascalCase string prices and the item fee from kobo', () => {
      const [item] =
        mapKudaBillItems([
          {
            ItemCode: 'KUD-CAB-STT-SUPER',
            ItemName: 'DTT SUPER MONTHLY 9500NGN',
            Amount: '950000',
            IsAmountFixed: true,
            ItemFee: '10000',
          },
        ]) ?? [];

      expect(item).toMatchObject({ amount: 9500, itemFee: 100 });
    });

    it('keeps kobo precision as naira and kobo', () => {
      const [item] =
        mapKudaBillItems([
          { itemCode: 'odd', itemName: 'Odd price', amount: 12345 },
        ]) ?? [];

      expect(item?.amount).toBe(123.45);
    });

    it('converts nested bill items too', () => {
      const [item] =
        mapKudaBillItems([
          {
            itemCode: 'parent',
            itemName: 'Parent',
            amount: 0,
            billItems: [
              { itemCode: 'child', itemName: 'Child', amount: 250000 },
            ],
          },
        ]) ?? [];

      expect(item?.billItems?.[0]?.amount).toBe(2500);
    });
  });

  it('keeps open-amount items at zero', () => {
    const [item] =
      mapKudaBillItems([
        {
          kudaIdentifier: 'KUD-ELE-EKED-002',
          name: 'EKEDC PREPAID',
          amount: 0,
          isFixedPrice: false,
        },
      ]) ?? [];

    expect(item).toMatchObject({
      amount: 0,
      isAmountFixed: false,
      itemCode: 'KUD-ELE-EKED-002',
      itemCurrencySymbol: 'NGN',
      itemFee: 0,
      itemName: 'EKEDC PREPAID',
    });
  });

  it('drops a fixed-price item whose price cannot be read', () => {
    expect(
      mapKudaBillItems([
        { itemCode: 'bad', itemName: 'Bad', amount: 'abc', isFixedPrice: true },
      ])
    ).toBeUndefined();
  });

  it('treats unreadable open-amount prices as zero', () => {
    const [item] =
      mapKudaBillItems([
        { itemCode: 'bad', itemName: 'Bad price', amount: 'abc' },
      ]) ?? [];

    expect(item?.amount).toBe(0);
  });

  it('drops items without a code or name and returns undefined when none remain', () => {
    expect(
      mapKudaBillItems([null, 'x', { itemName: 'No code', amount: 100 }])
    ).toBeUndefined();
    expect(mapKudaBillItems([])).toBeUndefined();
    expect(mapKudaBillItems(undefined)).toBeUndefined();
  });

  describe('unit guard', () => {
    beforeEach(() => {
      mockLoggerWarn.mockReset();
    });

    it('warns when a fixed price looks like naira rather than kobo', () => {
      mapKudaBillItems([
        {
          itemCode: 'cheap',
          itemName: 'Cheap',
          amount: 500,
          isFixedPrice: true,
        },
      ]);

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ itemCode: 'cheap', rawAmount: 500 })
      );
    });

    it('stays quiet for normal kobo prices and open amounts', () => {
      mapKudaBillItems([
        { itemCode: 'a', itemName: 'A', amount: 100000, isFixedPrice: true },
        { itemCode: 'b', itemName: 'B', amount: 0, isFixedPrice: false },
      ]);

      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });
  });
});
