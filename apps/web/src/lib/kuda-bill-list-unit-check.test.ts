import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoggerError = vi.fn();
vi.mock('./logger', () => ({
  logger: { error: (...args: unknown[]) => mockLoggerError(...args) },
}));

import { assertKudaBillListInKobo } from './kuda-bill-list-unit-check';

/** Real naira prices of an unnamed data list, e.g. "1GB Monthly Plan" = 1000. */
const NAIRA_PRICES = [100, 200, 500, 1000, 1500, 2000, 3500, 5000, 10000];

describe('assertKudaBillListInKobo', () => {
  beforeEach(() => {
    mockLoggerError.mockReset();
  });

  describe('bugfix: a naira-priced list with unnamed items passed as kobo', () => {
    it('refuses an answer whose prices are in naira and logs why', () => {
      // Kuda sends "1GB Monthly Plan" as 1000 (naira): read as kobo that is
      // ₦10, which the per-item guards accept; the whole answer gives it away.
      expect(() =>
        assertKudaBillListInKobo(NAIRA_PRICES, 'Internet Data')
      ).toThrow('Bill prices could not be confirmed as kobo');
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          billTypeName: 'Internet Data',
          belowFloor: 7,
          fixedPrices: 9,
        })
      );
    });
  });

  it('accepts an answer priced in kobo and stays quiet', () => {
    const koboPrices = NAIRA_PRICES.map((naira) => naira * 100);

    expect(() =>
      assertKudaBillListInKobo(koboPrices, 'Internet Data')
    ).not.toThrow();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('accepts an empty answer', () => {
    expect(() => assertKudaBillListInKobo([], 'CableTv')).not.toThrow();
  });
});
