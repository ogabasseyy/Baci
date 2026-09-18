import { describe, expect, it } from 'vitest';
import { applicablePriceKobo } from './applicable-price-kobo';

const base = {
  currentPriceKobo: 9_700_000,
  guaranteedPriceKobo: 10_000_000,
};

describe('applicablePriceKobo', () => {
  it('takes the lower of guaranteed and current prices', () => {
    // Arrange & Act & Assert
    expect(applicablePriceKobo(base)).toBe(9_700_000);
    expect(applicablePriceKobo({ ...base, currentPriceKobo: 11_000_000 })).toBe(
      10_000_000
    );
  });

  it('honours a live protected offer until expiry', () => {
    // Arrange & Act
    const price = applicablePriceKobo({
      ...base,
      now: new Date('2026-09-01T00:00:00.000Z'),
      protectedOfferExpiresAt: new Date('2026-09-10T00:00:00.000Z'),
      protectedOfferPriceKobo: 9_000_000,
    });

    // Assert
    expect(price).toBe(9_000_000);
  });

  it('falls back after the protected offer expires', () => {
    // Arrange & Act
    const price = applicablePriceKobo({
      ...base,
      now: new Date('2026-09-11T00:00:00.000Z'),
      protectedOfferExpiresAt: new Date('2026-09-10T00:00:00.000Z'),
      protectedOfferPriceKobo: 9_000_000,
    });

    // Assert
    expect(price).toBe(9_700_000);
  });

  it('fails closed on malformed offer dates instead of discarding protection', () => {
    // Arrange & Act & Assert
    expect(() =>
      applicablePriceKobo({
        ...base,
        now: new Date('2026-09-01T00:00:00.000Z'),
        protectedOfferExpiresAt: new Date('not-a-date'),
        protectedOfferPriceKobo: 9_000_000,
      })
    ).toThrow(RangeError);
  });
});
