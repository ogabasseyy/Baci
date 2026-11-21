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
import { startimes, superPackage } from './kuda-bill-item-price.test-fixtures';
import {
  KUDA_BILL_PRICE_CHANGED_MESSAGE,
  KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE,
} from './kuda-bill-item-price-messages';
import { KudaApiHttpError } from './kuda-transport-error';

describe('assertKudaBillItemPriceCurrent when Kuda is unavailable', () => {
  beforeEach(() => {
    clearKudaBillItemPriceCacheForTests();
    mockGetBillersByCategory.mockReset();
    mockLoggerWarn.mockReset();
    mockGetBillersByCategory.mockResolvedValue([startimes()]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('when Kuda fails or answers with an empty list', () => {
    it.each([
      [
        'times out',
        () =>
          mockGetBillersByCategory.mockRejectedValue(
            new Error('Kuda GET_BILLERS_BY_TYPE request timed out')
          ),
      ],
      [
        'drops the connection',
        () =>
          mockGetBillersByCategory.mockRejectedValue(
            new TypeError('fetch failed')
          ),
      ],
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

    it.each([
      ['is empty', () => mockGetBillersByCategory.mockResolvedValue([])],
      [
        'lists billers without packages',
        () =>
          mockGetBillersByCategory.mockResolvedValue([
            startimes({ billItems: [] }),
          ]),
      ],
      [
        'rejects the request with a 4xx',
        () =>
          mockGetBillersByCategory.mockRejectedValue(
            new KudaApiHttpError(400, 'Bad Request')
          ),
      ],
      [
        'sends a list refused as priced in naira',
        () =>
          mockGetBillersByCategory.mockRejectedValue(
            new Error('Bill prices could not be confirmed as kobo')
          ),
      ],
    ])('refuses instead of using the last good list when Kuda %s', async (_label, breakKuda) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
      await assertKudaBillItemPriceCurrent(superPackage);
      vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
      breakKuda();

      await expect(
        assertKudaBillItemPriceCurrent(superPackage)
      ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
      // Still refused (not the saved list) while Kuda isn't asked again.
      vi.setSystemTime(new Date('2026-11-17T12:00:10Z'));
      await expect(
        assertKudaBillItemPriceCurrent(superPackage)
      ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
    });

    it('does not revive the saved list after a refused answer and then a timeout', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
      await assertKudaBillItemPriceCurrent(superPackage);
      vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
      mockGetBillersByCategory.mockResolvedValue([]);
      await expect(
        assertKudaBillItemPriceCurrent(superPackage)
      ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);

      // Past the 30-second pause, Kuda now times out.
      vi.setSystemTime(new Date('2026-11-17T12:01:00Z'));
      mockGetBillersByCategory.mockRejectedValue(
        new Error('Kuda GET_BILLERS_BY_TYPE request timed out')
      );

      await expect(
        assertKudaBillItemPriceCurrent(superPackage)
      ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
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

    it.each([
      'SOME-FIXED-PLAN',
      'KUD-ELE-NEW-FIXED',
    ])('fails unlisted electricity code %s closed with no list', async (code) => {
      mockGetBillersByCategory.mockResolvedValue([]);

      await expect(
        assertKudaBillItemPriceCurrent({
          amount: 5000,
          billItemIdentifier: code,
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

  describe('bugfix: Baci meter items made a package-less Kuda answer look good', () => {
    const fixedMeterTopUp = {
      amount: 5000,
      isAmountFixed: true,
      itemCode: 'KUD-ELE-AEDC-FIXED-5000',
      itemCurrencySymbol: 'NGN',
      itemFee: 0,
      itemName: 'AEDC fixed top-up',
    };
    const aedc = (billItems: unknown[]) => ({
      billerId: 'aedc',
      billerName: 'AEDC',
      billerType: 'Electricity',
      categoryId: 'electricity',
      categoryName: 'Electricity',
      billItems,
    });
    const purchase = {
      amount: 5000,
      billItemIdentifier: 'KUD-ELE-AEDC-FIXED-5000',
      billerName: 'AEDC',
      type: 'electricity',
    };

    it('asks Kuda for its own answer, without Baci meter items', async () => {
      mockGetBillersByCategory.mockResolvedValue([aedc([fixedMeterTopUp])]);

      await assertKudaBillItemPriceCurrent(purchase);

      expect(mockGetBillersByCategory).toHaveBeenCalledWith('electricity', {
        addElectricityMeterItems: false,
      });
    });

    it('refuses rather than use the last good electricity list when Kuda lists no packages', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
      mockGetBillersByCategory.mockResolvedValue([aedc([fixedMeterTopUp])]);
      await assertKudaBillItemPriceCurrent(purchase);
      vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
      mockGetBillersByCategory.mockResolvedValue([aedc([])]);

      await expect(assertKudaBillItemPriceCurrent(purchase)).rejects.toThrow(
        KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE
      );
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Kuda price list came back without packages',
          type: 'electricity',
        })
      );
    });
  });
});
