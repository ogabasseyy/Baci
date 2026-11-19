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

  describe('bugfix: a list sent in naira slipped past the under-₦10 check', () => {
    beforeEach(() => {
      mockLoggerWarn.mockClear();
    });

    it.each([
      'StarTimes DTT SUPER MONTHLY 9500NGN',
      'DStv Compact NGN 9,500',
      'Bouquet N9500 monthly',
      'Bouquet ₦9,500',
      'Bouquet 9500 naira',
    ])('drops "%s" when Kuda sends 9500 instead of 950000', (name) => {
      const items = mapKudaBillItems([
        { itemCode: 'flip', itemName: name, amount: 9500, isFixedPrice: true },
        {
          itemCode: 'ok',
          itemName: 'Plain',
          amount: 100000,
          isFixedPrice: true,
        },
      ]);

      // One list shares one unit: the plain item is in doubt too.
      expect(items).toBeUndefined();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ itemCode: 'flip', rawAmount: 9500 })
      );
    });

    it('keeps the item when the price is in kobo as expected', () => {
      const [item] =
        mapKudaBillItems([
          {
            itemCode: 'st',
            itemName: 'StarTimes DTT SUPER MONTHLY 9500NGN',
            amount: 950000,
            isFixedPrice: true,
          },
        ]) ?? [];

      expect(item?.amount).toBe(9500);
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });

    it.each([
      'MTN 1GB Monthly Plan (30 Days)',
      'Airtel 1.5TB Data (1 Year)',
      'Nightly Plan 100GB',
    ])('ignores names without a naira price ("%s")', (name) => {
      const items = mapKudaBillItems([
        { itemCode: 'x', itemName: name, amount: 100000, isFixedPrice: true },
      ]);

      expect(items?.[0]?.amount).toBe(1000);
    });

    it('leaves open-amount items alone even when the name has a price', () => {
      const [item] =
        mapKudaBillItems([
          {
            itemCode: 'open',
            itemName: 'Top up N500',
            amount: 500,
            isFixedPrice: false,
          },
        ]) ?? [];

      expect(item?.itemCode).toBe('open');
    });
  });

  describe('bugfix: a naira list with unnamed plans priced at ₦10 and up', () => {
    beforeEach(() => {
      mockLoggerWarn.mockClear();
    });

    it('drops every fixed price in a list where one price looks like naira', () => {
      // A data list sent in naira: "1GB Monthly Plan" at 1000 would map to
      // ₦10 and pass the under-₦10 check; its ₦100 sibling gives the unit away.
      const items = mapKudaBillItems([
        {
          itemCode: '1gb',
          itemName: '1GB Monthly Plan',
          amount: 1000,
          isFixedPrice: true,
        },
        {
          itemCode: '100mb',
          itemName: '100MB Daily Plan',
          amount: 100,
          isFixedPrice: true,
        },
        {
          itemCode: 'open',
          itemName: 'Top up',
          amount: 0,
          isFixedPrice: false,
        },
      ]);

      expect(items?.map((item) => item.itemCode)).toEqual(['open']);
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ droppedFixedItems: 2 })
      );
    });

    it('keeps a normal kobo list whole', () => {
      const items = mapKudaBillItems([
        {
          itemCode: '1gb',
          itemName: '1GB Monthly Plan',
          amount: 100000,
          isFixedPrice: true,
        },
        {
          itemCode: '100mb',
          itemName: '100MB Daily Plan',
          amount: 10000,
          isFixedPrice: true,
        },
      ]);

      expect(items?.map((item) => item.amount)).toEqual([1000, 100]);
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });

    it('checks each nested list on its own', () => {
      const [biller] =
        mapKudaBillItems([
          {
            itemCode: 'group',
            itemName: 'Group',
            amount: 0,
            isFixedPrice: false,
            billItems: [
              {
                itemCode: 'cheap',
                itemName: 'A',
                amount: 100,
                isFixedPrice: true,
              },
            ],
          },
          { itemCode: 'ok', itemName: 'B', amount: 100000, isFixedPrice: true },
        ]) ?? [];

      expect(biller?.itemCode).toBe('group');
      expect(biller?.billItems).toBeUndefined();
    });
  });
});
