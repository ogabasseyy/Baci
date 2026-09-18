import { describe, expect, it } from 'vitest';
import {
  getContactValidationError,
  normalizeOptionalEmail,
} from './negotiation-contact-validation';

describe('negotiation contact validation', () => {
  it('normalizes optional email addresses for storage', () => {
    expect(normalizeOptionalEmail('  Buyer@Example.COM  ')).toBe(
      'buyer@example.com'
    );
    expect(normalizeOptionalEmail('')).toBeNull();
  });

  it('rejects invalid or overlong email addresses', () => {
    expect(normalizeOptionalEmail('a@b@c.com')).toBeNull();
    expect(normalizeOptionalEmail(`${'a'.repeat(250)}@x.com`)).toBeNull();
  });

  it('returns the submit-time contact validation message', () => {
    expect(
      getContactValidationError({ email: 'not an email', phone: '' })
    ).toBe('Enter a valid email address.');
    expect(getContactValidationError({ email: '', phone: 'not a phone' })).toBe(
      'Enter a valid Phone / WhatsApp number.'
    );
    expect(
      getContactValidationError({
        email: 'buyer@example.com',
        phone: '0803 123 4567',
      })
    ).toBeNull();
    expect(getContactValidationError({ email: '', phone: '' })).toBe(
      "Provide an email address or Phone / WhatsApp number so we can send the merchant's decision."
    );
  });

  it('can defer missing contact validation to the authoritative submitter', () => {
    // Arrange
    const input = { allowMissingContact: true, email: '', phone: '' };

    // Act
    const result = getContactValidationError(input);

    // Assert
    expect(result).toBeNull();
  });

  it('rejects invalid form email even when an account contact exists', () => {
    // Arrange
    const input = {
      email: 'not an email',
      allowMissingContact: true,
      phone: '',
    };

    // Act
    const result = getContactValidationError(input);

    // Assert
    expect(result).toBe('Enter a valid email address.');
  });
});
