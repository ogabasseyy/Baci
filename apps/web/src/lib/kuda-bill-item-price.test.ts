import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetBillersByCategory = vi.fn();
const mockLoggerWarn = vi.fn();
vi.mock('./kuda-bills', () => ({
  getBillersByCategory: (...args: unknown[]) =>
    mockGetBillersByCategory(...args),
}));
vi.mock('./logger', () => ({
  logger: { warn: (...args: unknown[]) => mockLoggerWarn(...args) },
}));

import {
  assertKudaBillItemPriceCurrent,
  clearKudaBillItemPriceCacheForTests,
} from './kuda-bill-item-price';
import {
  KUDA_BILL_PRICE_CHANGED_MESSAGE,
  KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE,
} from './kuda-bill-item-price-messages';

const startimesSuper = {
  amount: 9500,
  isAmountFixed: true,
  itemCode: 'KUD-CAB-STT-SUPER',
  itemCurrencySymbol: 'NGN',
  itemFee: 0,
  itemName: 'DTT SUPER MONTHLY 9500NGN',
};

function startimes(overrides: Record<string, unknown> = {}) {
  return {
    billerId: 'startimes',
    billerName: 'STARTIMES NG',
    billerType: 'Cable',
    categoryId: 'cable',
    categoryName: 'CableTv',
    billItems: [
      {
        ...startimesSuper,
        amount: 0,
        isAmountFixed: false,
        itemCode: 'group',
        itemName: 'Group',
        billItems: [startimesSuper],
      },
    ],
    ...overrides,
  };
}

const superPackage = {
  amount: 9500,
  billItemIdentifier: 'KUD-CAB-STT-SUPER',
  type: 'cable_tv',
};

describe('assertKudaBillItemPriceCurrent', () => {
  beforeEach(() => {
    clearKudaBillItemPriceCacheForTests();
    mockGetBillersByCategory.mockReset();
    mockLoggerWarn.mockReset();
    mockGetBillersByCategory.mockResolvedValue([startimes()]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('bugfix: a saved 100x cable price could still be charged', () => {
    it('rejects a cable package sent at the old 100x price', async () => {
      await expect(
        assertKudaBillItemPriceCurrent({ ...superPackage, amount: 950000 })
      ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
      expect(mockGetBillersByCategory).toHaveBeenCalledWith('cable_tv');
    });
  });

  it('matches item codes regardless of case and spacing', async () => {
    await expect(
      assertKudaBillItemPriceCurrent({
        ...superPackage,
        amount: 950000,
        billItemIdentifier: ' kud-cab-stt-super ',
      })
    ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
  });

  it('accepts a cable package at its current price', async () => {
    await expect(
      assertKudaBillItemPriceCurrent(superPackage)
    ).resolves.toBeUndefined();
  });

  it('leaves unknown items to the provider', async () => {
    await expect(
      assertKudaBillItemPriceCurrent({
        ...superPackage,
        amount: 1234,
        billItemIdentifier: 'KUD-CAB-UNKNOWN',
      })
    ).resolves.toBeUndefined();
  });

  it('lets open-amount items through at any amount', async () => {
    mockGetBillersByCategory.mockResolvedValue([
      startimes({
        billItems: [
          {
            ...startimesSuper,
            amount: 0,
            isAmountFixed: false,
            itemCode: 'KUD-ELE-EKED-002',
          },
        ],
      }),
    ]);

    await expect(
      assertKudaBillItemPriceCurrent({
        amount: 5000,
        billItemIdentifier: 'KUD-ELE-EKED-002',
        type: 'electricity',
      })
    ).resolves.toBeUndefined();
  });

  it('checks fixed-price items of any bill type', async () => {
    mockGetBillersByCategory.mockResolvedValue([
      startimes({ billItems: [{ ...startimesSuper, itemCode: 'KUD-BET-1' }] }),
    ]);

    await expect(
      assertKudaBillItemPriceCurrent({
        amount: 950000,
        billItemIdentifier: 'KUD-BET-1',
        type: 'betting',
      })
    ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
  });

  describe('when several billers list the item', () => {
    beforeEach(() => {
      mockGetBillersByCategory.mockResolvedValue([
        startimes({ billerName: 'STARTIMES NG (Kuda)' }),
        startimes({
          billerId: 'startimes-2',
          billerName: 'STARTIMES PLUS',
          billItems: [{ ...startimesSuper, amount: 9000 }],
        }),
      ]);
    });

    it('checks the chosen biller, matched as the billers list showed it', async () => {
      await expect(
        assertKudaBillItemPriceCurrent({
          ...superPackage,
          billerName: '  startimes ng - Group ',
        })
      ).resolves.toBeUndefined();
      await expect(
        assertKudaBillItemPriceCurrent({
          ...superPackage,
          amount: 9000,
          billerName: 'STARTIMES NG',
        })
      ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
    });

    it('accepts the chosen biller when any of its listings matches', async () => {
      mockGetBillersByCategory.mockResolvedValue([
        startimes({
          billItems: [startimesSuper, { ...startimesSuper, amount: 9900 }],
        }),
      ]);

      await expect(
        assertKudaBillItemPriceCurrent({
          ...superPackage,
          billerName: 'STARTIMES NG',
        })
      ).resolves.toBeUndefined();
    });

    it('accepts any listed price when the biller is not identified', async () => {
      await expect(
        assertKudaBillItemPriceCurrent({ ...superPackage, amount: 9000 })
      ).resolves.toBeUndefined();
      await expect(
        assertKudaBillItemPriceCurrent({ ...superPackage, amount: 950000 })
      ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
    });
  });

  it('reuses the price list for a minute', async () => {
    await assertKudaBillItemPriceCurrent(superPackage);
    await assertKudaBillItemPriceCurrent(superPackage);

    expect(mockGetBillersByCategory).toHaveBeenCalledTimes(1);
  });

  describe('when Kuda fails or answers with an empty list', () => {
    it.each([
      [
        'fails',
        () =>
          mockGetBillersByCategory.mockRejectedValue(new Error('Kuda down')),
      ],
      ['is empty', () => mockGetBillersByCategory.mockResolvedValue([])],
    ])('keeps blocking stale prices with the last good list when Kuda %s', async (_label, breakKuda) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
      await assertKudaBillItemPriceCurrent(superPackage);
      vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
      breakKuda();

      await expect(
        assertKudaBillItemPriceCurrent({ ...superPackage, amount: 950000 })
      ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
      await expect(
        assertKudaBillItemPriceCurrent(superPackage)
      ).resolves.toBeUndefined();
      expect(mockLoggerWarn).toHaveBeenCalled();
    });

    it('fails a fixed-price cable package closed with no list from the past day', async () => {
      mockGetBillersByCategory.mockRejectedValue(new Error('Kuda down'));

      await expect(
        assertKudaBillItemPriceCurrent(superPackage)
      ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ hasLastGoodList: false, type: 'cable_tv' })
      );
    });

    it('fails an electricity code outside the meter products closed with no list', async () => {
      mockGetBillersByCategory.mockResolvedValue([]);

      await expect(
        assertKudaBillItemPriceCurrent({
          amount: 5000,
          billItemIdentifier: 'SOME-FIXED-PLAN',
          type: 'electricity',
        })
      ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
    });

    it('lets open-amount electricity continue with no list', async () => {
      mockGetBillersByCategory.mockResolvedValue([]);

      await expect(
        assertKudaBillItemPriceCurrent({
          amount: 5000,
          billItemIdentifier: 'KUD-ELE-EKED-002',
          type: 'electricity',
        })
      ).resolves.toBeUndefined();
    });

    it.each([
      ['betting', 'KUD-BET-1'],
      ['cable_tv', 'KUD-CAB-STT-SUPER'],
    ])('fails %s closed with no list from the past day', async (type, code) => {
      mockGetBillersByCategory.mockResolvedValue([]);

      await expect(
        assertKudaBillItemPriceCurrent({
          amount: 1000,
          billItemIdentifier: code,
          type,
        })
      ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
    });

    it('waits 30 seconds before asking Kuda again after a failure', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
      mockGetBillersByCategory.mockRejectedValue(new Error('Kuda down'));
      await expect(
        assertKudaBillItemPriceCurrent(superPackage)
      ).rejects.toThrow();
      await expect(
        assertKudaBillItemPriceCurrent(superPackage)
      ).rejects.toThrow();
      expect(mockGetBillersByCategory).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date('2026-11-17T10:00:31Z'));
      mockGetBillersByCategory.mockResolvedValue([startimes()]);
      await expect(
        assertKudaBillItemPriceCurrent(superPackage)
      ).resolves.toBeUndefined();
      expect(mockGetBillersByCategory).toHaveBeenCalledTimes(2);
    });

    it('ignores a last good list older than a day', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
      await assertKudaBillItemPriceCurrent(superPackage);
      vi.setSystemTime(new Date('2026-11-18T10:00:01Z'));
      mockGetBillersByCategory.mockRejectedValue(new Error('Kuda down'));

      await expect(
        assertKudaBillItemPriceCurrent(superPackage)
      ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
    });
  });
});
