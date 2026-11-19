import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoggerError = vi.fn();
vi.mock('./logger', () => ({
  logger: { error: (...args: unknown[]) => mockLoggerError(...args) },
}));

import {
  assertKudaBillListInKobo,
  collectRawFixedPricesKobo,
  KUDA_BILL_LIST_UNIT_ERROR,
  looksLikeNairaPricedList,
} from './kuda-bill-list-unit-check';

/** Real naira prices of an unnamed data list, e.g. "1GB Monthly Plan" = 1000. */
const NAIRA_PRICES = [100, 200, 500, 1000, 1500, 2000, 3500, 5000, 10000];

describe('assertKudaBillListInKobo', () => {
  beforeEach(() => {
    mockLoggerError.mockReset();
  });

  describe('bugfix: a naira-priced list with unnamed items passed as kobo', () => {
    it('refuses an answer whose prices are in naira, whatever the items are called', () => {
      // Kuda sends "1GB Monthly Plan" as 1000 (naira): read as kobo that is
      // ₦10, which the per-item guards accept; the whole answer gives it away.
      expect(() =>
        assertKudaBillListInKobo(NAIRA_PRICES, 'Internet Data')
      ).toThrow(KUDA_BILL_LIST_UNIT_ERROR);
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          billTypeName: 'Internet Data',
          belowFloor: 7,
          fixedPrices: 9,
        })
      );
    });
  });

  it('accepts an answer priced in kobo like production (cheapest price is ₦50)', () => {
    const koboPrices = [
      5000,
      20000,
      100000,
      ...NAIRA_PRICES.map((n) => n * 100),
    ];

    expect(() =>
      assertKudaBillListInKobo(koboPrices, 'Internet Data')
    ).not.toThrow();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('tolerates a few cheap items in an otherwise kobo-priced answer', () => {
    const prices = [
      3000,
      ...Array.from({ length: 29 }, (_, i) => (i + 1) * 1e5),
    ];

    expect(looksLikeNairaPricedList(prices)).toEqual({
      belowFloor: 1,
      fixedPrices: 30,
      isNaira: false,
    });
  });

  it('judges the share at the boundary: 10% under the floor is naira, less is not', () => {
    const expensive = Array.from({ length: 9 }, () => 100000);

    expect(looksLikeNairaPricedList([3000, ...expensive]).isNaira).toBe(true);
    expect(looksLikeNairaPricedList([3000, ...expensive, 100000]).isNaira).toBe(
      false
    );
  });

  it('treats exactly 5000 kobo (₦50) as sellable, not under the floor', () => {
    expect(looksLikeNairaPricedList([5000, 5000, 5000, 5000, 5000])).toEqual({
      belowFloor: 0,
      fixedPrices: 5,
      isNaira: false,
    });
  });

  it('does not judge an answer with too few fixed prices', () => {
    expect(looksLikeNairaPricedList([100, 200, 500, 1000])).toEqual({
      belowFloor: 4,
      fixedPrices: 4,
      isNaira: false,
    });
    expect(() => assertKudaBillListInKobo([], 'CableTv')).not.toThrow();
  });
});

describe('collectRawFixedPricesKobo', () => {
  it('reads fixed prices in either casing at any depth and skips the rest', () => {
    const prices = collectRawFixedPricesKobo([
      { amount: 100000, isFixedPrice: true },
      { Amount: '950000', IsAmountFixed: true },
      { Amount: '1,250,000', IsAmountFixed: true },
      {
        amount: 0,
        isAmountFixed: false,
        billItems: [{ amount: 250000, isAmountFixed: true }],
      },
      { amount: 700000 },
      { amount: 'oops', isAmountFixed: true },
      { amount: 0, isAmountFixed: true },
      { amount: -5, isAmountFixed: true },
      null,
      'text',
    ]);

    expect(prices).toEqual([100000, 950000, 1250000, 250000]);
  });

  it('returns nothing when there are no items', () => {
    expect(collectRawFixedPricesKobo(undefined)).toEqual([]);
    expect(collectRawFixedPricesKobo([])).toEqual([]);
  });
});
