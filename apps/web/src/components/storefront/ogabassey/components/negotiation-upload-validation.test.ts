import { describe, expect, it } from 'vitest';
import { getUploadFormValidationError } from './negotiation-upload-validation';

describe('negotiation upload validation', () => {
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
});
