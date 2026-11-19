import { describe, expect, it } from 'vitest';
import {
  CustomerLoginEmailHintSchema,
  maskCustomerLoginEmailHint,
  sanitizeCustomerLoginEmailHint,
  sanitizeMaskedCustomerLoginEmailHint,
} from './customer-login-email-hint';

describe('CustomerLoginEmailHintSchema', () => {
  it('normalizes valid login email hints', () => {
    expect(
      CustomerLoginEmailHintSchema.parse('  BasseyBJohn@Yahoo.CO.UK  ')
    ).toBe('basseybjohn@yahoo.co.uk');
  });

  it('rejects invalid and overlong email hints', () => {
    expect(CustomerLoginEmailHintSchema.safeParse('not-an-email').success).toBe(
      false
    );
    expect(
      CustomerLoginEmailHintSchema.safeParse(`${'a'.repeat(250)}@example.com`)
        .success
    ).toBe(false);
  });
});

describe('sanitizeCustomerLoginEmailHint', () => {
  it('returns the first valid query email hint', () => {
    expect(
      sanitizeCustomerLoginEmailHint([
        '  Shopper@Example.COM  ',
        'other@example.com',
      ])
    ).toBe('shopper@example.com');
  });

  it('skips invalid query email candidates before returning the first valid one', () => {
    expect(
      sanitizeCustomerLoginEmailHint([
        'https://evil.example',
        '  Shopper@Example.COM  ',
      ])
    ).toBe('shopper@example.com');
  });

  it('drops missing or invalid email hints', () => {
    expect(sanitizeCustomerLoginEmailHint(null)).toBe('');
    expect(sanitizeCustomerLoginEmailHint(undefined)).toBe('');
    expect(sanitizeCustomerLoginEmailHint('')).toBe('');
    expect(sanitizeCustomerLoginEmailHint('https://evil.example')).toBe('');
  });
});

describe('maskCustomerLoginEmailHint', () => {
  it('masks the local part keeping first character and domain', () => {
    expect(maskCustomerLoginEmailHint('  BasseyBJohn@Yahoo.CO.UK  ')).toBe(
      'b***@yahoo.co.uk'
    );
  });

  it('drops missing or invalid emails', () => {
    expect(maskCustomerLoginEmailHint(null)).toBe('');
    expect(maskCustomerLoginEmailHint('not-an-email')).toBe('');
  });
});

describe('sanitizeMaskedCustomerLoginEmailHint', () => {
  it('accepts masked hints and drops anything else', () => {
    expect(sanitizeMaskedCustomerLoginEmailHint('b***@yahoo.co.uk')).toBe(
      'b***@yahoo.co.uk'
    );
    expect(
      sanitizeMaskedCustomerLoginEmailHint('basseybjohn@yahoo.co.uk')
    ).toBe('');
    expect(sanitizeMaskedCustomerLoginEmailHint(null)).toBe('');
  });
});
