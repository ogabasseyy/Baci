import { describe, expect, it } from 'vitest';
import {
  buildCustomerAddressLine,
  buildCustomerFullName,
  buildCustomerNameFields,
  buildCustomerRecordNameFields,
  buildCustomerSearchFilter,
  CUSTOMER_ADMIN_COLUMNS,
  getCustomerDisplayName,
  normalizeCustomerType,
  splitCustomerFullName,
} from './customers';

describe('customer contracts', () => {
  it('builds a full name from first and last names', () => {
    expect(buildCustomerFullName('Ada', 'Lovelace')).toBe('Ada Lovelace');
  });

  it('falls back to a trimmed legacy full name when split names are absent', () => {
    expect(buildCustomerFullName(null, undefined, '  Ada Byron  ')).toBe(
      'Ada Byron'
    );
  });

  it('falls back to email username when all names are missing', () => {
    expect(
      buildCustomerNameFields({ email: 'merchant@example.com' })
    ).toMatchObject({
      first_name: null,
      last_name: null,
      full_name: 'merchant',
    });
  });

  it('uses a non-standard email string as the final fallback name', () => {
    expect(
      buildCustomerNameFields({ email: 'merchant-without-at-sign' })
    ).toEqual({
      first_name: null,
      last_name: null,
      full_name: 'merchant-without-at-sign',
    });
  });

  it('splits a legacy full name into first and last names', () => {
    expect(splitCustomerFullName('Ada Lovelace')).toEqual({
      first_name: 'Ada',
      last_name: 'Lovelace',
    });
  });

  it('splits multi-part legacy names without losing the trailing segments', () => {
    expect(splitCustomerFullName('  Ada   Byron   King ')).toEqual({
      first_name: 'Ada',
      last_name: 'Byron King',
    });
  });

  it('returns a sensible display name', () => {
    expect(
      getCustomerDisplayName({
        email: 'guest@example.com',
        first_name: null,
        full_name: null,
        last_name: null,
      })
    ).toBe('guest');
  });

  it('falls back to Guest when no name or email is available', () => {
    expect(
      getCustomerDisplayName({
        email: null,
        first_name: null,
        full_name: null,
        last_name: null,
      })
    ).toBe('Guest');
  });

  it('searches across full name and split name fields', () => {
    expect(buildCustomerSearchFilter('Ada')).toContain('full_name.ilike.%Ada%');
    expect(buildCustomerSearchFilter('Ada')).toContain(
      'first_name.ilike.%Ada%'
    );
  });

  it('searches the company name field too', () => {
    expect(buildCustomerSearchFilter('Acme')).toContain(
      'company_name.ilike.%Acme%'
    );
  });

  it('normalizes only the exact company value to a company type', () => {
    expect(normalizeCustomerType('company')).toBe('company');
    expect(normalizeCustomerType('individual')).toBe('individual');
    expect(normalizeCustomerType(null)).toBe('individual');
    expect(normalizeCustomerType('Company')).toBe('individual');
  });

  it('shows the company name for company customers', () => {
    expect(
      getCustomerDisplayName({
        company_name: '  Acme Ltd  ',
        customer_type: 'company',
        email: 'ops@acme.com',
        first_name: null,
        full_name: null,
        last_name: null,
      })
    ).toBe('Acme Ltd');
  });

  it('falls back to person logic when a company has no company name', () => {
    expect(
      getCustomerDisplayName({
        company_name: '   ',
        customer_type: 'company',
        email: 'ops@acme.com',
        first_name: null,
        full_name: null,
        last_name: null,
      })
    ).toBe('ops');
  });

  it('builds company record fields, mirroring company name into full name', () => {
    expect(
      buildCustomerRecordNameFields({
        company_name: '  Acme Ltd ',
        customer_type: 'company',
        first_name: 'ignored',
        last_name: 'ignored',
      })
    ).toEqual({
      company_name: 'Acme Ltd',
      customer_type: 'company',
      first_name: null,
      full_name: 'Acme Ltd',
      last_name: null,
    });
  });

  it('does not synthesize a missing company name from email or full name', () => {
    expect(
      buildCustomerRecordNameFields({
        company_name: '   ',
        customer_type: 'company',
        email: 'ops@acme.com',
        full_name: 'Acme fallback',
      })
    ).toEqual({
      company_name: null,
      customer_type: 'company',
      first_name: null,
      full_name: null,
      last_name: null,
    });
  });

  it('builds individual record fields with no company name', () => {
    expect(
      buildCustomerRecordNameFields({
        customer_type: 'individual',
        first_name: 'Ada',
        last_name: 'Lovelace',
      })
    ).toEqual({
      company_name: null,
      customer_type: 'individual',
      first_name: 'Ada',
      full_name: 'Ada Lovelace',
      last_name: 'Lovelace',
    });
  });

  it('sanitizes reserved characters out of the search filter value', () => {
    expect(buildCustomerSearchFilter('Ada,%_. King')).toContain(
      'full_name.ilike.%Ada King%'
    );
  });

  it('returns a non-matching filter when punctuation is stripped entirely', () => {
    expect(buildCustomerSearchFilter('.,%_')).toBe('id.is.null');
  });

  it('builds a full address from populated parts only', () => {
    expect(buildCustomerAddressLine('12 Allen Avenue', '', 'Ikeja')).toBe(
      '12 Allen Avenue, Ikeja'
    );
  });

  it('returns null when every address fragment is empty', () => {
    expect(buildCustomerAddressLine('', ' ', null, undefined)).toBeNull();
  });

  it('includes structured locality columns in the admin customer projection', () => {
    expect(CUSTOMER_ADMIN_COLUMNS).toContain('city');
    expect(CUSTOMER_ADMIN_COLUMNS).toContain('state');
    expect(CUSTOMER_ADMIN_COLUMNS).toContain('zip_code');
    expect(CUSTOMER_ADMIN_COLUMNS).toContain('country');
    expect(CUSTOMER_ADMIN_COLUMNS).toContain('country_code');
    expect(CUSTOMER_ADMIN_COLUMNS).toContain('latitude');
    expect(CUSTOMER_ADMIN_COLUMNS).toContain('longitude');
  });
});
