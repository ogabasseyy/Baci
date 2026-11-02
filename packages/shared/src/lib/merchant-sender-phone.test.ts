import { describe, expect, it } from 'vitest';
import { isPlausibleMerchantContactPhone } from './merchant-contact-phone';
import { isPlausibleMerchantSenderPhone } from './merchant-sender-phone';
import { normalizePhoneToE164 } from './negotiation-contact';

describe('isPlausibleMerchantSenderPhone', () => {
  it('rejects bare numbers that booking would read as a short Nigerian number', () => {
    // Each passes the support-phone rule but normalizes to fewer than
    // 234 + ten digits, so booking would refuse it as the sender phone.
    for (const value of ['15781234', '1234567', '23415781', '2341234567']) {
      expect(isPlausibleMerchantContactPhone(value), value).toBe(true);
      expect(isPlausibleMerchantSenderPhone(value), value).toBe(false);
    }
  });

  it('accepts complete Nigerian numbers written without a country code', () => {
    for (const value of [
      '08146978921',
      '0814 697 8921',
      '(0814) 697-8921',
      '8146978921',
      '2348146978921',
      '23408146978921',
    ]) {
      expect(isPlausibleMerchantSenderPhone(value), value).toBe(true);
      expect(normalizePhoneToE164(value), value).toBe('2348146978921');
    }
  });

  it('accepts international numbers that pass the contact phone rule', () => {
    expect(isPlausibleMerchantSenderPhone('+234 814 697 8921')).toBe(true);
    expect(isPlausibleMerchantSenderPhone('+23408146978921')).toBe(true);
    expect(isPlausibleMerchantSenderPhone('002348146978921')).toBe(true);
    expect(isPlausibleMerchantSenderPhone('+233201234567')).toBe(true);
    expect(isPlausibleMerchantSenderPhone('00447911123456')).toBe(true);
  });

  it('rejects a foreign number whose + is not the first character', () => {
    // Booking only treats a leading + as international, so these normalize
    // to 234 + the foreign digits and the booking would be refused.
    for (const value of ['(+44) 7911 123456', '(+233) 20 123 4567']) {
      expect(isPlausibleMerchantContactPhone(value), value).toBe(true);
      expect(isPlausibleMerchantSenderPhone(value), value).toBe(false);
    }
    expect(isPlausibleMerchantSenderPhone('(+234) 814 697 8921')).toBe(true);
    expect(normalizePhoneToE164('(+234) 814 697 8921')).toBe('2348146978921');
    expect(isPlausibleMerchantSenderPhone('+(44) 7911 123456')).toBe(true);
    expect(isPlausibleMerchantSenderPhone('(0044) 7911 123456')).toBe(true);
  });

  it('asks other countries for their country code', () => {
    // A Ghanaian national number would be misread as Nigerian by booking.
    expect(isPlausibleMerchantSenderPhone('0241234567')).toBe(false);
    expect(isPlausibleMerchantSenderPhone('+233241234567')).toBe(true);
  });

  it('keeps every contact phone rejection', () => {
    for (const value of [
      '+23415781',
      '+234814697892',
      '15781',
      '',
      null,
      undefined,
      'dyuaqv',
      '0814+6978921',
    ]) {
      expect(isPlausibleMerchantSenderPhone(value), String(value)).toBe(false);
    }
  });
});
