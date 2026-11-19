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
    expect(looksLikeNairaPricedList([]).isNaira).toBe(false);
  });
});
