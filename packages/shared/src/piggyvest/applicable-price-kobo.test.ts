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

  it('keeps a lower catalogue price during a live offer', () => {
    // Regression: the live offer acted as an override, resolving a
    // ₦97,000 offer against a ₦90,000 current price to ₦97,000 and
    // leaving a funded plan marked not ready. The offer is one more
    // ceiling, never a floor above the catalogue rule.
    // Arrange & Act
    const price = applicablePriceKobo({
      currentPriceKobo: 9_000_000,
      guaranteedPriceKobo: 10_000_000,
      now: new Date('2026-09-01T00:00:00.000Z'),
      protectedOfferExpiresAt: new Date('2026-09-10T00:00:00.000Z'),
      protectedOfferPriceKobo: 9_700_000,
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

  it('rejects an offer price without an expiry instead of silently dropping it', () => {
    // Arrange & Act & Assert
    expect(() =>
      applicablePriceKobo({
        ...base,
        now: new Date('2026-09-01T00:00:00.000Z'),
        protectedOfferPriceKobo: 9_000_000,
      })
    ).toThrow(RangeError);
  });

  it('rejects an offer expiry without a price instead of silently dropping it', () => {
    // Arrange & Act & Assert
    expect(() =>
      applicablePriceKobo({
        ...base,
        now: new Date('2026-09-01T00:00:00.000Z'),
        protectedOfferExpiresAt: new Date('2026-09-10T00:00:00.000Z'),
      })
    ).toThrow(RangeError);
  });
});
