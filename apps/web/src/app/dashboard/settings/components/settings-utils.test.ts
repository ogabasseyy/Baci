import { describe, expect, it } from 'vitest';
import {
  createSettingsSchema,
  sanitizeSocialMedia,
  settingsSchema,
} from './settings-utils';

describe('settingsSchema', () => {
  it('accepts a valid business name and country', () => {
    expect(
      settingsSchema.safeParse({
        business_name: 'My Store',
        country: 'NG',
        site_description: 'Thoughtful products for everyday life.',
        support_email: ' support@example.com ',
        support_phone: ' +234 800 000 0000 ',
      }).success
    ).toBe(true);
  });

  it('normalizes the storefront description and public support contacts', () => {
    const result = settingsSchema.safeParse({
      business_name: 'My Store',
      country: 'NG',
      site_description: '  Thoughtful products for everyday life.  ',
      support_email: ' SUPPORT@EXAMPLE.COM ',
      support_phone: ' +234 800 000 0000 ',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        site_description: 'Thoughtful products for everyday life.',
        support_email: 'support@example.com',
        support_phone: '+234 800 000 0000',
      });
    }
  });

  it('rejects a malformed public support email', () => {
    expect(
      settingsSchema.safeParse({
        business_name: 'My Store',
        country: 'NG',
        site_description: '',
        support_email: 'not-an-email',
        support_phone: '',
      }).success
    ).toBe(false);
  });

  it('rejects a truncated +234 support phone that the database refuses', () => {
    const result = settingsSchema.safeParse({
      business_name: 'My Store',
      country: 'NG',
      site_description: '',
      support_email: '',
      support_phone: '+23415781',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['support_phone']);
    }
  });

  it('keeps a complete business phone and allows clearing it', () => {
    const base = { business_name: 'My Store', country: 'NG' };

    const complete = settingsSchema.safeParse({
      ...base,
      phone: ' +234 803 123 4567 ',
    });
    expect(complete.success && complete.data.phone).toBe('+234 803 123 4567');
    const cleared = settingsSchema.safeParse({ ...base, phone: '' });
    expect(cleared.success && cleared.data.phone).toBe('');
  });

  it('rejects the truncated business phone couriers could not call', () => {
    const result = settingsSchema.safeParse({
      business_name: 'My Store',
      country: 'NG',
      phone: '+23415781',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({
        message:
          'Enter the full business phone number with its country code, for example +234 801 234 5678.',
        path: ['phone'],
      });
    }
  });

  it('rejects an oversized storefront description', () => {
    expect(
      settingsSchema.safeParse({
        business_name: 'My Store',
        country: 'NG',
        site_description: 'a'.repeat(321),
        support_email: '',
        support_phone: '',
      }).success
    ).toBe(false);
  });

  it('trims surrounding whitespace on business_name', () => {
    const result = settingsSchema.safeParse({
      business_name: '  Zorvexa  ',
      country: 'NG',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.business_name).toBe('Zorvexa');
    }
  });

  it('rejects a business name shorter than 2 characters after trimming', () => {
    // Trimming happens before the length check, so " a " collapses to "a".
    expect(
      settingsSchema.safeParse({ business_name: ' a ', country: 'NG' }).success
    ).toBe(false);
  });

  it('rejects a country shorter than 2 characters', () => {
    expect(
      settingsSchema.safeParse({ business_name: 'My Store', country: 'N' })
        .success
    ).toBe(false);
  });

  it('accepts an INR-market country code (IN) unchanged', () => {
    const result = settingsSchema.safeParse({
      business_name: 'My Store',
      country: 'IN',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.country).toBe('IN');
    }
  });

  it('normalizes a full country name to its ISO-2 code instead of writing it verbatim', () => {
    const result = settingsSchema.safeParse({
      business_name: 'My Store',
      country: 'Nigeria',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.country).toBe('NG');
    }
  });

  it('rejects an unrecognizable country instead of persisting garbage', () => {
    expect(
      settingsSchema.safeParse({
        business_name: 'My Store',
        country: 'Wakanda',
      }).success
    ).toBe(false);
  });
});

describe('createSettingsSchema', () => {
  const base = { business_name: 'My Store', country: 'NG' };
  const legacyBaseline = { phone: '+23415781', support_phone: '+23480312' };

  it('accepts truncated legacy phones that match the loaded baseline', () => {
    const result = createSettingsSchema(legacyBaseline).safeParse({
      ...base,
      phone: ' +23415781 ',
      support_phone: '+23480312',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a truncated phone that differs from the loaded baseline', () => {
    const result = createSettingsSchema(legacyBaseline).safeParse({
      ...base,
      phone: '+2341578',
      support_phone: '+2348031',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toEqual([
        ['support_phone'],
        ['phone'],
      ]);
    }
  });

  it('still allows clearing a legacy phone', () => {
    const result = createSettingsSchema(legacyBaseline).safeParse({
      ...base,
      phone: '',
      support_phone: '',
    });

    expect(result.success).toBe(true);
  });
});

describe('sanitizeSocialMedia', () => {
  it('trims each value and preserves keys', () => {
    const result = sanitizeSocialMedia({
      instagram: '  baci  ',
      twitter: 'baci',
    });
    expect(result.instagram).toBe('baci');
    expect(result.twitter).toBe('baci');
  });

  it('returns an empty object for empty input', () => {
    expect(sanitizeSocialMedia({})).toEqual({});
  });
});
