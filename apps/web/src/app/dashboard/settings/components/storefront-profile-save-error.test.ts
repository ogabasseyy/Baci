import { describe, expect, it } from 'vitest';
import { toStorefrontProfileSaveError } from './storefront-profile-save-error';

describe('toStorefrontProfileSaveError', () => {
  it('explains a phone number the database refused instead of its bare code', () => {
    const rejection = { code: '22023', message: 'invalid_support_phone' };

    const error = toStorefrontProfileSaveError(rejection);

    expect(error.message).toBe(
      'A phone number looks incomplete. Enter the full number with its country code, for example +234 801 234 5678.'
    );
    expect(error.cause).toBe(rejection);
  });

  it('asks for a fresh sign-in or second factor when contact changes need one', () => {
    expect(
      toStorefrontProfileSaveError(
        new Error('merchant_settings_reauthentication_required')
      ).message
    ).toBe('Sign in again before changing your contact details.');
    expect(
      toStorefrontProfileSaveError({
        message: 'merchant_settings_mfa_required',
      }).message
    ).toBe('Verify your second factor before changing your contact details.');
  });

  it('keeps any other failure unchanged', () => {
    const conflict = new Error('merchant_settings_conflict');

    expect(toStorefrontProfileSaveError(conflict)).toBe(conflict);
    expect(toStorefrontProfileSaveError({ message: 'boom' }).message).toBe(
      'boom'
    );
    expect(toStorefrontProfileSaveError('offline').message).toBe('offline');
  });
});
