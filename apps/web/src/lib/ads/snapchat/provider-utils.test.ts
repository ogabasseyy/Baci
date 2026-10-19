import { describe, expect, it } from 'vitest';
import {
  decimal,
  integer,
  isIsoDate,
  microToDecimal,
  snapchatAdsLocalMidnight,
} from './provider-utils';

describe('Snapchat Ads provider utilities', () => {
  it('accepts finite numeric stats without coercing large digit strings', () => {
    expect(integer(12)).toBe('12');
    expect(decimal(1.5)).toBe('1.5');
    expect(integer('9007199254740993')).toBe('9007199254740993');
    expect(integer(-1)).toBeNull();
    expect(decimal(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('validates dates and converts micros without losing precision', () => {
    expect(isIsoDate('2026-08-20')).toBe(true);
    expect(isIsoDate('20-08-2026')).toBe(false);
    expect(microToDecimal('9007199254740993')).toBe('9007199254.740993');
  });

  it('rejects invalid timezone input before creating a provider window', () => {
    expect(() => snapchatAdsLocalMidnight('2026-08-20', 'Not/AZone')).toThrow(
      'SNAPCHAT_ADS_TIMEZONE_INVALID'
    );
  });
});
