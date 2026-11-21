import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoggerWarn = vi.fn();
vi.mock('./logger', () => ({
  logger: { warn: (...args: unknown[]) => mockLoggerWarn(...args) },
}));

import { mapKudaBillItems } from './kuda-bill-items';

describe('mapKudaBillItems unit-flip guards', () => {
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
      const items = mapKudaBillItems([
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
      ]);

      // The nested list's doubt does not reach its outer sibling, and the
      // group left with no children is dropped rather than kept as an
      // open-amount product.
      expect(items?.map((item) => [item.itemCode, item.amount])).toEqual([
        ['ok', 1000],
      ]);
    });
  });

  describe('robustness: grouped figures and incidental "N" text', () => {
    beforeEach(() => {
      mockLoggerWarn.mockClear();
    });

    it('reads a comma-grouped kobo amount', () => {
      const [item] =
        mapKudaBillItems([
          {
            itemCode: 'st',
            itemName: 'StarTimes DTT SUPER MONTHLY',
            amount: '950,000',
            isFixedPrice: true,
          },
        ]) ?? [];

      expect(item?.amount).toBe(9500);
    });

    it.each([
      'MTN 1GB Monthly Plan',
      'MTN100 Bonus Plan',
      'Plan NG500 bundle',
    ])('does not read "%s" as a naira price', (name) => {
      const items = mapKudaBillItems([
        { itemCode: 'x', itemName: name, amount: 100, isFixedPrice: false },
        { itemCode: 'y', itemName: name, amount: 100000, isFixedPrice: true },
      ]);

      expect(items?.map((item) => item.itemCode)).toEqual(['x', 'y']);
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });

    it('treats a bare "N" followed by digits as a naira price on purpose', () => {
      // "Plan N100" sent as 100 matches its own stated price: the list is in
      // doubt, so its fixed prices are dropped (fail closed, never undercharged).
      const items = mapKudaBillItems([
        {
          itemCode: 'p',
          itemName: 'Plan N100',
          amount: 100,
          isFixedPrice: true,
        },
      ]);

      expect(items).toBeUndefined();
    });
  });
});
