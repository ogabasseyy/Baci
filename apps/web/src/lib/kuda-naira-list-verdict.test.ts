import { describe, expect, it } from 'vitest';
import { looksLikeNairaPricedList } from './kuda-naira-list-verdict';

/** Real naira prices of an unnamed data list, e.g. "1GB Monthly Plan" = 1000. */
const NAIRA_PRICES = [100, 200, 500, 1000, 1500, 2000, 3500, 5000, 10000];

describe('looksLikeNairaPricedList', () => {
  it('flags an answer whose prices are in naira, whatever the items are called', () => {
    expect(looksLikeNairaPricedList(NAIRA_PRICES)).toEqual({
      belowFloor: 7,
      fixedPrices: 9,
      isNaira: true,
      tooFewToJudge: false,
    });
  });

  it('accepts an answer priced in kobo like production (cheapest price is ₦50)', () => {
    const koboPrices = [
      5000,
      20000,
      100000,
      ...NAIRA_PRICES.map((n) => n * 100),
    ];

    expect(looksLikeNairaPricedList(koboPrices).isNaira).toBe(false);
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
      tooFewToJudge: false,
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
      tooFewToJudge: false,
    });
  });

  describe('bugfix: a small naira-priced answer could never be told from kobo', () => {
    it.each([
      [1, [500000]],
      [2, [500000, 950000]],
      [4, [100, 200, 500, 1000]],
    ])('marks an answer with %i fixed price(s) as too few to judge', (count, prices) => {
      // One package sent as 5000 (naira) reads as ₦50 and passes every other
      // check, so a small answer cannot establish its unit.
      expect(looksLikeNairaPricedList(prices)).toMatchObject({
        fixedPrices: count,
        tooFewToJudge: true,
      });
    });

    it('does not mark an answer with no fixed prices, or with five or more', () => {
      expect(looksLikeNairaPricedList([])).toMatchObject({
        fixedPrices: 0,
        isNaira: false,
        tooFewToJudge: false,
      });
      expect(
        looksLikeNairaPricedList([500000, 500000, 500000, 500000, 500000])
      ).toMatchObject({ isNaira: false, tooFewToJudge: false });
    });
  });
});
