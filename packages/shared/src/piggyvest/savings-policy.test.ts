import { describe, expect, it } from 'vitest';
import {
  activationThresholdKobo,
  addCalendarMonthsClamped,
  applicablePriceKobo,
  isActivated,
  isReady,
  maturityStatus,
  purchasingPowerKobo,
  SAVINGS_POLICY_VERSION,
} from './index';

describe('savings-policy v1 (shared)', () => {
  it('is versioned', () => {
    expect(SAVINGS_POLICY_VERSION).toBe(1);
  });

  it('pending interest is not spendable: 9.5M principal + 300k paid + 200k pending is not ready for 10M', () => {
    const spendable = purchasingPowerKobo(9_500_000, 300_000);
    expect(spendable).toBe(9_800_000);
    expect(isReady(spendable, 10_000_000)).toBe(false);
  });

  it('one verified payout credits once: +200k paid reaches exactly 10M and ready', () => {
    const spendable = purchasingPowerKobo(9_500_000, 500_000);
    expect(spendable).toBe(10_000_000);
    expect(isReady(spendable, 10_000_000)).toBe(true);
  });

  it('activation threshold is 5%: 499,999 does not activate, 500,000 does on a 10M quote', () => {
    expect(activationThresholdKobo(10_000_000)).toBe(500_000);
    expect(isActivated(499_999, 10_000_000)).toBe(false);
    expect(isActivated(500_000, 10_000_000)).toBe(true);
  });

  it('price falls: guarantee 10M, current 9.7M, spendable 9.8M is ready with 100k surplus', () => {
    const price = applicablePriceKobo({
      guaranteedPriceKobo: 10_000_000,
      currentPriceKobo: 9_700_000,
    });
    expect(price).toBe(9_700_000);
    expect(isReady(9_800_000, price)).toBe(true);
  });

  it('price rises: valid 10M guarantee caps the ceiling despite 11M current', () => {
    const price = applicablePriceKobo({
      guaranteedPriceKobo: 10_000_000,
      currentPriceKobo: 11_000_000,
    });
    expect(price).toBe(10_000_000);
  });

  it('protected offer is honoured until expiry, then falls back to guarantee/current', () => {
    const args = {
      guaranteedPriceKobo: 10_000_000,
      currentPriceKobo: 11_000_000,
      protectedOfferPriceKobo: 9_700_000,
      protectedOfferExpiresAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    expect(
      applicablePriceKobo({ ...args, now: new Date('2026-09-20T00:00:00Z') })
    ).toBe(9_700_000);
    expect(
      applicablePriceKobo({ ...args, now: new Date('2026-10-02T00:00:00Z') })
    ).toBe(10_000_000);
  });

  it('maturity: active before 6 months, grace within 30 days after, review-required past grace', () => {
    const activatedAt = new Date('2026-01-15T10:00:00.000Z');
    expect(maturityStatus(activatedAt, new Date('2026-06-14T10:00:00Z'))).toBe(
      'active'
    );
    expect(maturityStatus(activatedAt, new Date('2026-07-20T10:00:00Z'))).toBe(
      'grace'
    );
    expect(maturityStatus(activatedAt, new Date('2026-08-20T10:00:00Z'))).toBe(
      'review-required'
    );
  });

  it('month-end clamps: 31 Aug + 6 months lands on end of Feb, not March', () => {
    const activatedAt = new Date('2025-08-31T10:00:00.000Z');
    expect(maturityStatus(activatedAt, new Date('2026-02-27T10:00:00Z'))).toBe(
      'active'
    );
    expect(maturityStatus(activatedAt, new Date('2026-02-28T10:00:01Z'))).toBe(
      'grace'
    );
  });

  it('matures on the Lagos calendar date, not the UTC date', () => {
    // 2026-03-01T00:00:00+01:00 is midnight March 1 in Lagos but February 28
    // in UTC. Maturity must land on September 1 Lagos (Aug 31 23:00 UTC),
    // not August 28/29 UTC.
    const activatedAt = new Date('2026-03-01T00:00:00+01:00');
    const maturity = addCalendarMonthsClamped(activatedAt, 6);
    expect(maturity.toISOString()).toBe('2026-08-31T23:00:00.000Z');
    expect(maturityStatus(activatedAt, new Date('2026-08-31T22:59:59Z'))).toBe(
      'active'
    );
    expect(maturityStatus(activatedAt, new Date('2026-08-31T23:00:01Z'))).toBe(
      'grace'
    );
  });

  it('keeps month-end clamping on the Lagos calendar', () => {
    // March 31 Lagos midnight + 1 month clamps to April 30 Lagos midnight.
    const activatedAt = new Date('2026-03-31T00:00:00+01:00');
    const maturity = addCalendarMonthsClamped(activatedAt, 1);
    expect(maturity.toISOString()).toBe('2026-04-29T23:00:00.000Z');
  });

  it('rejects negative or fractional kobo', () => {
    expect(() => purchasingPowerKobo(-1, 0)).toThrow(RangeError);
    expect(() => purchasingPowerKobo(1.5, 0)).toThrow(RangeError);
  });

  it('rejects zero prices while zero balances stay valid', () => {
    // A zero quote must never activate an unfunded plan or price at zero.
    expect(() => activationThresholdKobo(0)).toThrow(RangeError);
    expect(() => isActivated(0, 0)).toThrow(RangeError);
    expect(() =>
      applicablePriceKobo({ guaranteedPriceKobo: 0, currentPriceKobo: 0 })
    ).toThrow(RangeError);
    // A zero applicable price must never read ready: isReady(0, 0) would
    // otherwise mark an unfunded plan ready.
    expect(() => isReady(0, 0)).toThrow(RangeError);
    expect(() => isReady(9_800_000, 0)).toThrow(RangeError);
    expect(purchasingPowerKobo(0, 0)).toBe(0);
    expect(isActivated(0, 10_000_000)).toBe(false);
    expect(isReady(0, 10_000_000)).toBe(false);
  });

  it('rejects invalid dates', () => {
    expect(() => addCalendarMonthsClamped(new Date('invalid'), 6)).toThrow(
      RangeError
    );
  });
});
