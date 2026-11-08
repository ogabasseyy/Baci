import { describe, expect, it } from 'vitest';
import { hasPublishableContactInfo } from './has-publishable-contact-info';

describe('hasPublishableContactInfo', () => {
  const emptyTrustProfile = {};

  it('returns true when merchant pages contact is non-empty', () => {
    expect(
      hasPublishableContactInfo(
        { pages: { contact: 'Reach us here' } },
        emptyTrustProfile
      )
    ).toBe(true);
  });

  it('returns true when merchant email is non-empty', () => {
    expect(
      hasPublishableContactInfo(
        { email: 'support@example.com' },
        emptyTrustProfile
      )
    ).toBe(true);
  });

  it('returns true when merchant phone is non-empty', () => {
    expect(
      hasPublishableContactInfo({ phone: '+2348000000000' }, emptyTrustProfile)
    ).toBe(true);
  });

  it('returns true when trust profile supportEmail is non-empty', () => {
    expect(
      hasPublishableContactInfo({}, { supportEmail: 'help@brand.com' })
    ).toBe(true);
  });

  it('returns true when trust profile supportPhone is non-empty', () => {
    expect(
      hasPublishableContactInfo({}, { supportPhone: '+2349000000000' })
    ).toBe(true);
  });

  it('returns false when all values are whitespace or empty strings', () => {
    expect(
      hasPublishableContactInfo(
        {
          pages: { contact: '   ' },
          email: '',
          phone: ' \t\n ',
        },
        {
          supportEmail: '',
          supportPhone: '  ',
        }
      )
    ).toBe(false);
  });

  it('returns false when merchant fields and trust profile fields are null or undefined', () => {
    expect(
      hasPublishableContactInfo(
        {
          pages: null,
          email: null,
          phone: null,
        },
        emptyTrustProfile
      )
    ).toBe(false);
  });
});
