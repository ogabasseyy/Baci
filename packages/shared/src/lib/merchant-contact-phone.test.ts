import { describe, expect, it } from 'vitest';
import { isPlausibleMerchantContactPhone } from './merchant-contact-phone';

describe('isPlausibleMerchantContactPhone', () => {
  it('rejects the truncated +234 numbers that reached production', () => {
    for (const value of ['+23415781', '+23450642', '+23444633']) {
      expect(isPlausibleMerchantContactPhone(value), value).toBe(false);
    }
  });

  it('accepts a full Nigerian number with or without formatting', () => {
    expect(isPlausibleMerchantContactPhone('+2348146978921')).toBe(true);
    expect(isPlausibleMerchantContactPhone('+234 814 697 8921')).toBe(true);
    expect(isPlausibleMerchantContactPhone('+234 (814) 697-8921')).toBe(true);
    expect(isPlausibleMerchantContactPhone('002348146978921')).toBe(true);
  });

  it('tolerates the trunk 0 the phone picker keeps after +234', () => {
    expect(isPlausibleMerchantContactPhone('+23408146978921')).toBe(true);
  });

  it('requires exactly ten national digits after +234', () => {
    expect(isPlausibleMerchantContactPhone('+234814697892')).toBe(false);
    expect(isPlausibleMerchantContactPhone('+23481469789211')).toBe(false);
    expect(isPlausibleMerchantContactPhone('+2340814697892')).toBe(false);
    expect(isPlausibleMerchantContactPhone('+234')).toBe(false);
  });

  it('accepts E.164 numbers from other countries', () => {
    expect(isPlausibleMerchantContactPhone('+14165550123')).toBe(true);
    expect(isPlausibleMerchantContactPhone('+447911123456')).toBe(true);
    expect(isPlausibleMerchantContactPhone('+233201234567')).toBe(true);
  });

  it('rejects international numbers outside the E.164 length range', () => {
    expect(isPlausibleMerchantContactPhone('+1234567')).toBe(false);
    expect(isPlausibleMerchantContactPhone('+1234567890123456')).toBe(false);
    expect(isPlausibleMerchantContactPhone('+0123456789')).toBe(false);
  });

  it('keeps national-format numbers to 7-15 digits', () => {
    expect(isPlausibleMerchantContactPhone('08146978921')).toBe(true);
    expect(isPlausibleMerchantContactPhone('0814 697 8921')).toBe(true);
    expect(isPlausibleMerchantContactPhone('15781')).toBe(false);
    expect(isPlausibleMerchantContactPhone('0123456789012345')).toBe(false);
  });

  it('rejects blanks, letters and misplaced plus signs', () => {
    expect(isPlausibleMerchantContactPhone('')).toBe(false);
    expect(isPlausibleMerchantContactPhone('   ')).toBe(false);
    expect(isPlausibleMerchantContactPhone(null)).toBe(false);
    expect(isPlausibleMerchantContactPhone(undefined)).toBe(false);
    expect(isPlausibleMerchantContactPhone('dyuaqv')).toBe(false);
    expect(isPlausibleMerchantContactPhone('0814+6978921')).toBe(false);
  });
});
