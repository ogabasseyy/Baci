import { describe, expect, it } from 'vitest';
import {
  NegotiationValidationError,
  getContactValidationError,
  getUploadFormValidationError,
  isValidEvidenceLink,
  normalizeOptionalEmail,
} from './negotiation-modal-validation';

describe('negotiation modal validation helpers', () => {
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

  it('accepts only http(s) evidence links', () => {
    expect(isValidEvidenceLink('https://proof.example/item')).toBe(true);
    expect(isValidEvidenceLink('http://proof.example/item')).toBe(true);
    expect(isValidEvidenceLink('ftp://proof.example/item')).toBe(false);
    expect(isValidEvidenceLink('not a url')).toBe(false);
    expect(isValidEvidenceLink('')).toBe(false);
  });

  it('validates the evidence form without any client access', () => {
    const valid = {
      currentPrice: 100_000,
      merchantId: 'merchant-1',
      offer: '90000',
      uploadFile: null,
      uploadLink: 'https://proof.example/item',
    };
    expect(getUploadFormValidationError(valid)).toBeNull();

    // A file alone is valid evidence too.
    expect(
      getUploadFormValidationError({
        ...valid,
        uploadFile: new File(['proof'], 'proof.png', { type: 'image/png' }),
        uploadLink: '',
      })
    ).toBeNull();

    // Both evidence kinds at once.
    expect(
      getUploadFormValidationError({
        ...valid,
        uploadFile: new File(['proof'], 'proof.png', { type: 'image/png' }),
      })
    ).toBe('Use either a proof upload or a link, not both.');

    // Neither evidence kind.
    expect(
      getUploadFormValidationError({ ...valid, uploadLink: '   ' })
    ).toBe('Upload proof or paste a link before sending your request.');

    // Unsupported link scheme.
    expect(
      getUploadFormValidationError({
        ...valid,
        uploadLink: 'ftp://proof.example/item',
      })
    ).toBe('Enter a valid http or https URL.');

    // Offer outside (0, currentPrice].
    for (const offer of ['', '0', '-5', '100001', '90,000', '90000abc']) {
      expect(getUploadFormValidationError({ ...valid, offer })).toBe(
        'Enter a valid offer amount before sending your request.'
      );
    }

    // Missing merchant context.
    expect(getUploadFormValidationError({ ...valid, merchantId: '' })).toBe(
      'Unable to submit request — merchant context unavailable.'
    );
  });

  it('uses a typed validation error for modal request failures', () => {
    const error = new NegotiationValidationError('Invalid contact');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('NegotiationValidationError');
    expect(error.message).toBe('Invalid contact');
  });
});
