import { hasLinePriceDrift } from './cart-reprice-drift';

describe('hasLinePriceDrift', () => {
  it('reports no drift for equal prices at any quantity', () => {
    expect(hasLinePriceDrift(2500, 2500, 1)).toBe(false);
    expect(hasLinePriceDrift(2500, 2500, 4)).toBe(false);
  });

  it('tolerates a line-total difference of exactly ±1', () => {
    expect(hasLinePriceDrift(1001, 1000, 1)).toBe(false);
    expect(hasLinePriceDrift(999, 1000, 1)).toBe(false);
  });

  it('flags a line-total difference just over ±1 in either direction', () => {
    expect(hasLinePriceDrift(1001.02, 1000, 1)).toBe(true);
    expect(hasLinePriceDrift(998.98, 1000, 1)).toBe(true);
  });

  it('scales the unit difference by quantity before comparing', () => {
    // 0.40/unit is inside tolerance for one unit but crosses it at 3.
    expect(hasLinePriceDrift(100.4, 100, 1)).toBe(false);
    expect(hasLinePriceDrift(100.4, 100, 3)).toBe(true);
  });

  it('floors fractional quantities like the checkout line basis', () => {
    // 2.9 units floors to 2: 0.60 * 2 = 1.20 still drifts, but a
    // would-be 3-unit total is not assumed.
    expect(hasLinePriceDrift(100.6, 100, 2.9)).toBe(true);
    expect(hasLinePriceDrift(100.4, 100, 2.9)).toBe(false);
  });

  it('ignores sub-cent float dust via cent rounding', () => {
    expect(hasLinePriceDrift(10.005, 10, 1)).toBe(false);
    expect(hasLinePriceDrift(10, 10.004, 1)).toBe(false);
  });

  it('falls back to a single unit for non-positive or non-finite quantities', () => {
    expect(hasLinePriceDrift(12, 10, 0)).toBe(true);
    expect(hasLinePriceDrift(12, 10, -2)).toBe(true);
    expect(hasLinePriceDrift(12, 10, Number.NaN)).toBe(true);
    expect(hasLinePriceDrift(12, 10, Number.POSITIVE_INFINITY)).toBe(true);
    expect(hasLinePriceDrift(10.5, 10, 0)).toBe(false);
  });
});
