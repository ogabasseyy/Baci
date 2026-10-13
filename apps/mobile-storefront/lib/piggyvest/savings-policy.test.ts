import { describe, expect, it } from '@jest/globals';
import {
  applicablePriceKobo,
  isActivated,
  isReady,
  maturityStatus,
  purchasingPowerKobo,
  SAVINGS_POLICY_VERSION,
} from './savings-policy';

describe('piggyvest savings-policy v1 (mobile mirror)', () => {
  it('is versioned in lockstep with the web copy', () => {
    expect(SAVINGS_POLICY_VERSION).toBe(1);
  });

  it('pending interest is not spendable', () => {
    expect(purchasingPowerKobo(9_500_000, 300_000)).toBe(9_800_000);
    expect(isReady(9_800_000, 10_000_000)).toBe(false);
  });

  it('one verified payout reaches the target exactly', () => {
    expect(purchasingPowerKobo(9_500_000, 500_000)).toBe(10_000_000);
    expect(isReady(10_000_000, 10_000_000)).toBe(true);
  });

  it('activation threshold is 5% of the quoted price', () => {
    expect(isActivated(499_999, 10_000_000)).toBe(false);
    expect(isActivated(500_000, 10_000_000)).toBe(true);
  });

  it('applicable price is the lower of guarantee and current', () => {
    expect(
      applicablePriceKobo({
        guaranteedPriceKobo: 10_000_000,
        currentPriceKobo: 9_700_000,
      })
    ).toBe(9_700_000);
    expect(
      applicablePriceKobo({
        guaranteedPriceKobo: 10_000_000,
        currentPriceKobo: 11_000_000,
      })
    ).toBe(10_000_000);
  });

  it('maturity moves active -> grace -> review-required with no auto-forfeiture', () => {
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
});
