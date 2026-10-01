import { describe, expect, it } from 'vitest';
import {
  buildMailtoLink,
  buildTelLink,
  buildWhatsAppLink,
  isValidPhone,
  normalizePhoneToE164,
  normalizeStoredE164Phone,
} from './negotiation-contact';

describe('normalizePhoneToE164', () => {
  it('drops the trunk 0 and prefixes the dial code for national input', () => {
    expect(normalizePhoneToE164('0803 123 4567')).toBe('2348031234567');
  });

  it('strips a leading + and spaces from international input', () => {
    expect(normalizePhoneToE164('+234 803 123 4567')).toBe('2348031234567');
  });

  it('keeps a number already prefixed with the dial code', () => {
    expect(normalizePhoneToE164('2348031234567')).toBe('2348031234567');
  });

  it('prefixes the dial code for a bare national number without trunk 0', () => {
    expect(normalizePhoneToE164('8031234567')).toBe('2348031234567');
  });

  it('handles the 00 international prefix form', () => {
    expect(normalizePhoneToE164('002348031234567')).toBe('2348031234567');
  });

  it('drops trunk zeros after the Nigerian country code', () => {
    expect(normalizePhoneToE164('+234 0803 123 4567')).toBe('2348031234567');
    expect(normalizePhoneToE164('23408031234567')).toBe('2348031234567');
    expect(normalizePhoneToE164('0023408031234567')).toBe('2348031234567');
  });

  it('normalizes a mistaken plus-prefixed national number for the default market', () => {
    expect(normalizePhoneToE164('+0803 123 4567')).toBe('2348031234567');
  });

  it('respects a non-default dial code', () => {
    expect(normalizePhoneToE164('020 1234 5678', '44')).toBe('442012345678');
  });

  it('returns null for empty or non-string input', () => {
    expect(normalizePhoneToE164('')).toBeNull();
    expect(normalizePhoneToE164('   ')).toBeNull();
    expect(normalizePhoneToE164(null)).toBeNull();
    expect(normalizePhoneToE164(undefined)).toBeNull();
  });

  it('returns null for junk that is too short or too long', () => {
    expect(normalizePhoneToE164('12')).toBeNull();
    expect(normalizePhoneToE164('+1234567890123456789')).toBeNull();
  });
});

describe('normalizeStoredE164Phone', () => {
  it('preserves international account phones without applying the default dial code', () => {
    expect(normalizeStoredE164Phone('15551234567')).toBe('15551234567');
    expect(normalizeStoredE164Phone('+442012345678')).toBe('442012345678');
  });

  it('rejects national, formatted, and implausible account phone values', () => {
    expect(normalizeStoredE164Phone('08031234567')).toBeNull();
    expect(normalizeStoredE164Phone('+234 803 123 4567')).toBeNull();
    expect(normalizeStoredE164Phone('12')).toBeNull();
  });

  it('enforces the E.164 digit boundaries and rejects non-string values', () => {
    expect(normalizeStoredE164Phone('12345678')).toBe('12345678');
    expect(normalizeStoredE164Phone('1'.repeat(15))).toBe('1'.repeat(15));
    expect(normalizeStoredE164Phone('1'.repeat(16))).toBeNull();
    expect(normalizeStoredE164Phone(null)).toBeNull();
    expect(normalizeStoredE164Phone(undefined)).toBeNull();
    expect(normalizeStoredE164Phone(12345678 as never)).toBeNull();
  });
});

describe('isValidPhone', () => {
  it('is true for a normalizable number and false otherwise', () => {
    expect(isValidPhone('0803 123 4567')).toBe(true);
    expect(isValidPhone('abc')).toBe(false);
    expect(isValidPhone('')).toBe(false);
  });
});

describe('buildTelLink', () => {
  it('builds a tel: link with a + prefix', () => {
    expect(buildTelLink('0803 123 4567')).toBe('tel:+2348031234567');
  });

  it('returns null for an unreachable number', () => {
    expect(buildTelLink('nope')).toBeNull();
  });
});

describe('buildWhatsAppLink', () => {
  it('builds a wa.me link with digits only and no message', () => {
    expect(buildWhatsAppLink('0803 123 4567')).toBe(
      'https://wa.me/2348031234567'
    );
  });

  it('URL-encodes a prefilled message', () => {
    expect(
      buildWhatsAppLink('0803 123 4567', 'Hi! About your ₦420,000 offer')
    ).toBe(
      'https://wa.me/2348031234567?text=Hi!%20About%20your%20%E2%82%A6420%2C000%20offer'
    );
  });

  it('ignores a blank message', () => {
    expect(buildWhatsAppLink('0803 123 4567', '   ')).toBe(
      'https://wa.me/2348031234567'
    );
  });

  it('returns null for an unreachable number', () => {
    expect(buildWhatsAppLink('nope', 'hello')).toBeNull();
  });
});

describe('buildMailtoLink', () => {
  it('normalizes the recipient and encodes a follow-up subject and body', () => {
    expect(
      buildMailtoLink(
        ' Buyer@Example.COM ',
        'Negotiation follow-up',
        'Hi! About your offer — '
      )
    ).toBe(
      'mailto:buyer@example.com?subject=Negotiation%20follow-up&body=Hi!%20About%20your%20offer%20%E2%80%94'
    );
  });

  it('returns a bare mailto link when no message fields are provided', () => {
    expect(buildMailtoLink('buyer@example.com')).toBe(
      'mailto:buyer@example.com'
    );
  });

  it('omits blank subject and body fields', () => {
    expect(buildMailtoLink('buyer@example.com', '   ', '\t')).toBe(
      'mailto:buyer@example.com'
    );
  });

  it('returns null for an invalid recipient', () => {
    expect(buildMailtoLink('not-an-email', 'Subject')).toBeNull();
  });

  it('encodes recipient query delimiters before building a mailto link', () => {
    const link = buildMailtoLink(
      'buyer?bcc=attacker%40example.com&x=x@valid.com',
      'Subject'
    );

    expect(link).toBe(
      'mailto:buyer%3Fbcc%3Dattacker%2540example.com%26x%3Dx@valid.com?subject=Subject'
    );
    expect(link).not.toContain('?bcc=');
  });
});
